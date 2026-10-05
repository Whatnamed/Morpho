// Eval-only inter-trial stop gate. No Provider requests or product identity interpretation.
function responseRecords(text){
  if(!text)return[];
  try{return[JSON.parse(text)];}catch{}
  return text.split(/\r?\n/).filter(l=>l.startsWith("data: ")).flatMap(l=>{try{return[JSON.parse(l.slice(6))];}catch{return[];}});
}

export function findL2TerminalStop({messages,wire}){
  for(const response of wire){
    const records=responseRecords(response.response);
    for(const record of records){
      const code=record.code??record.failureCode??record.error?.code;
      if(["external_execution_state_unknown","provider_identity_conflict","effect_attempt_conflict"].includes(code))return{code,reason:"Unknown/conflicting external execution at trial terminal"};
      if(record.type==="externalError"||record.deliveryPending===true)return{code:code??"external_result_undelivered",reason:"External error or pending result at trial terminal"};
      if(record.type==="serverStatus"&&["externallyFailed","externallyCancelled"].includes(record.status))return{code:record.status,reason:"External execution did not deliver a valid terminal result"};
    }
    if(response.method!=="POST"||!response.url.endsWith("/requests"))continue;
    if(response.status!==200)return{code:"provider_request_failed",reason:"Provider request failed before a valid result was delivered"};
    const available=records.find(r=>r.type==="resultAvailable");
    const inline=records.some(r=>r.type==="providerOutput");
    const delivered=available?.delivery?.resultId&&wire.some(w=>w.method==="GET"&&w.status===200&&w.url.includes("/result?")&&w.url.includes(`resultId=${encodeURIComponent(available.delivery.resultId)}`)&&responseRecords(w.response).some(r=>r.type==="providerOutput"&&r.requestId===available.requestId));
    if(!inline&&!delivered)return{code:"external_result_undelivered",reason:"Request terminal result was not delivered to the client"};
  }
  if(!messages.length)return{code:"missing_trial_terminal",reason:"No terminal assistant outcome captured"};
  if(messages.some(m=>["failedDuringProvider","cancelledDuringProvider"].includes(m.agentTurnOutcome)))return{code:"provider_terminal_failure",reason:"Provider terminal failure/cancellation invalidates this quality trial"};
  return null;
}

export function l2UsageState(ledger){
  if(!ledger||!Number.isSafeInteger(ledger.requests)||!Number.isSafeInteger(ledger.settledRequests)||ledger.settledRequests<0||ledger.requests<ledger.settledRequests)return{status:"unknown",unsettledRequests:null,ledger:ledger??null};
  return{status:ledger.requests===ledger.settledRequests?"settled":"unknown",unsettledRequests:ledger.requests-ledger.settledRequests,ledger};
}

export async function waitForL2UsageSettlement(readLedger,{timeoutMs=30000,now=Date.now,pause=ms=>new Promise(r=>setTimeout(r,ms))}={}){
  const deadline=now()+timeoutMs;
  while(true){const state=l2UsageState(await readLedger());if(state.status==="settled"||now()>=deadline)return state;await pause(Math.min(100,Math.max(0,deadline-now())));}
}

export class L2TrialInfrastructureStop extends Error {
  constructor(stop){super(stop.reason);this.name="L2TrialInfrastructureStop";this.stop=stop;}
}

export async function enforceL2TrialBoundary(facts,{readLedger,persistStop,settleUsage,guardStop=null}){
  const detected=guardStop??findL2TerminalStop(facts);
  if(detected){
    const stop={id:"P7B-2-D3",stopKind:"terminal_infrastructure_outcome",...detected,trial:facts.key,trialStatus:"infrastructure-interrupted",usageAtDetection:l2UsageState(await readLedger())};
    // Block paid egress before waiting for any delayed body capture/usage settlement.
    await persistStop(stop);
    stop.usageAfterDrain=await settleUsage();
    // A late valid usage receipt can settle cost, but cannot make this trial resumable.
    throw new L2TrialInfrastructureStop(stop);
  }
  const usage=await settleUsage();
  if(usage.status!=="settled"){
    const stop={id:"P7B-2-D3",stopKind:"terminal_infrastructure_outcome",code:"usage_unsettled",reason:"Actual usage not settled; no next quality trial",trial:facts.key,trialStatus:"infrastructure-interrupted",usageAfterDrain:usage};
    await persistStop(stop);throw new L2TrialInfrastructureStop(stop);
  }
  return usage;
}
