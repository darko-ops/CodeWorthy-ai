// GitHub App authentication: mint a short-lived App JWT (RS256, signed with the
// App private key) and exchange it for an installation access token. No octokit
// dependency — node:crypto + fetch.
import { createSign } from "node:crypto";
import { config } from "../config.js";
import { createGitHubClient, type GitHubClient } from "./client.js";

const b64url = (b: Buffer | string) => Buffer.from(b).toString("base64url");

/** A ~9-minute App JWT. `nowSec`/`appId`/`privateKey` are injectable for tests. */
export function appJwt(
  nowSec: number = Math.floor(Date.now() / 1000),
  appId: string = config.github.appId,
  privateKey: string = config.github.privateKey
): string {
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = b64url(JSON.stringify({ iat: nowSec - 60, exp: nowSec + 540, iss: appId }));
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${payload}`);
  signer.end();
  return `${header}.${payload}.${b64url(signer.sign(privateKey))}`;
}

/** Exchange the App JWT for an installation token. */
export async function getInstallationToken(installationId: number, jwt: string = appJwt()): Promise<string> {
  const res = await fetch(`https://api.github.com/app/installations/${installationId}/access_tokens`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${jwt}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
    },
  });
  if (!res.ok) throw new Error(`installation token ${installationId} -> ${res.status}`);
  return ((await res.json()) as { token: string }).token;
}

export async function getInstallationClient(installationId: number): Promise<GitHubClient> {
  return createGitHubClient(await getInstallationToken(installationId));
}
