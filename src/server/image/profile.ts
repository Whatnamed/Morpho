export type GrsRequestProfile = {
  kind: "nanoBanana" | "gptImage" | "default";
  imageSize: string;
  replyType: string;
};

export function getGrsRequestProfile(model: string): GrsRequestProfile {
  const normalizedModel = model.toLowerCase();

  if (normalizedModel.includes("nano-banana")) {
    return {
      kind: "nanoBanana",
      imageSize: "1K",
      replyType: "json"
    };
  }

  if (normalizedModel.includes("gpt-image-2")) {
    return {
      kind: "gptImage",
      imageSize: "1024x768",
      replyType: "url"
    };
  }

  return {
    kind: "default",
    imageSize: "1024x768",
    replyType: "url"
  };
}
