// Applied only to the isolated Next server. No non-loopback network admission.
const net = require("node:net");
const original = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const options = Array.isArray(args[0]) ? args[0][0] : args[0];
  const host = typeof options === "object" ? options.host ?? "localhost" : typeof args[1] === "string" ? args[1] : "localhost";
  if (!["127.0.0.1", "localhost", "::1"].includes(host)) throw Error("P7B isolated server blocked non-loopback network");
  return original.apply(this, args);
};
