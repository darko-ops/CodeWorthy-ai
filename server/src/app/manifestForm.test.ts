// The consent screen must describe the App it actually creates.
//
// It didn't: the approver flow reused the Steward's hand-written permission
// list, so the page told the user they were granting Administration and Checks
// write on an App that asks for neither. Functionally the right App was
// created; the screen where consent is given was simply wrong about it. This
// pins the description to the manifest so the two cannot drift again.
import { describe, expect, it } from "vitest";
import { buildAppManifest, buildApproverManifest } from "./manifest.js";
import { renderManifestForm } from "./install.js";

const steward = buildAppManifest("https://cw.example.com");
const approver = buildApproverManifest("https://cw.example.com");

describe("the App creation consent screen", () => {
  it("names the App it is about to create", () => {
    expect(renderManifestForm(approver)).toContain("CodeWorthy Approver");
    expect(renderManifestForm(steward)).toContain("CodeWorthy Steward");
  });

  it("lists every permission the manifest actually asks for", () => {
    for (const manifest of [steward, approver]) {
      const html = renderManifestForm(manifest);
      for (const [name, level] of Object.entries(manifest.default_permissions)) {
        expect(html, `${manifest.name} / ${name}`).toContain(name.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()));
        expect(html).toContain(`<b>${level}</b>`);
      }
    }
  });

  it("never claims a permission the approver does not request", () => {
    // The actual bug. The approver gets no administration and no checks — so
    // the page must not say it does.
    const html = renderManifestForm(approver);
    expect(approver.default_permissions).not.toHaveProperty("administration");
    expect(approver.default_permissions).not.toHaveProperty("checks");
    expect(html).not.toContain("Administration");
    expect(html).not.toContain("Checks");
  });

  it("tells the approver's user what it cannot do, derived not asserted", () => {
    const html = renderManifestForm(approver);
    expect(html).toContain("change your repository settings");
    expect(html).toContain("post the check that gates a merge");
  });

  it("does not tell the Steward's user it cannot do things it can", () => {
    // The Steward DOES hold administration and checks; claiming otherwise
    // would be the same lie in the other direction.
    const html = renderManifestForm(steward);
    expect(html).not.toContain("change your repository settings");
    expect(html).not.toContain("post the check that gates a merge");
  });

  it("embeds the manifest it described, not another one", () => {
    const html = renderManifestForm(approver);
    expect(html).toContain("&quot;pull_requests&quot;:&quot;write&quot;");
    expect(html).not.toContain("&quot;administration&quot;");
  });
});
