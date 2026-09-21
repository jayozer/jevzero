import { localMode } from "./session";
export async function backend(path: string, body?: unknown) {
  const base = process.env.JEVZERO_BACKEND_URL,
    token = process.env.JEVZERO_BACKEND_TOKEN;
  if (!base || !token) throw Error("Backend not configured");
  const url = new URL(base);
  if (
    url.protocol !== "https:" &&
    !(
      localMode() &&
      url.protocol === "http:" &&
      ["localhost", "127.0.0.1"].includes(url.hostname)
    )
  )
    throw Error("Backend must use HTTPS");
  const response = await fetch(`${base.replace(/\/$/, "")}/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(20000),
  });
  const data = await response.json();
  return { status: response.status, data };
}
export async function boundedBody(request: Request) {
  if (!request.body) throw Error("Missing body");
  const reader = request.body.getReader(),
    chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 16000) {
        await reader.cancel();
        throw Error("Request too large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
