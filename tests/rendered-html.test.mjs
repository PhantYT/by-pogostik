import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const projectRoot = new URL("../", import.meta.url);

async function read(path) {
  return readFile(new URL(path, projectRoot), "utf8");
}

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the by pogostik shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>by pogostik/i);
  assert.match(html, /student OS/i);
  assert.match(html, /26-[^<]*1/);
});

test("keeps the official groups, hosted auth guard and resilient full-track player", async () => {
  const [page, serverData, schema, migration] = await Promise.all([
    read("app/page.tsx"),
    read("lib/server-data.ts"),
    read("db/schema.ts"),
    read("drizzle/0000_initial.sql"),
  ]);

  for (const [id, code] of [
    [8954, "26-ИСбо-1"],
    [8881, "26-ИСбо-2"],
    [9000, "26-ИСбо-3"],
    [8953, "26-ИСбо-4"],
    [8878, "26-ИСбо-5"],
    [8949, "26-ИБбо-6"],
    [8948, "26-ПМбо-1"],
  ]) {
    assert.match(serverData, new RegExp(`${id}.*${code}`));
    assert.match(migration, new RegExp(`${id}.*${code}`));
  }

  assert.match(page, /location\.hostname === "localhost"/);
  assert.match(page, /\/tracks\/\$\{encodeURIComponent\(item\.id\)\}\/stream/);
  assert.match(page, /onEnded=\{\(\) => void playNextTrack\(\)\}/);
  assert.match(page, /onError=\{handleAudioError\}/);
  assert.match(schema, /uq_users_single_super_admin/);
  assert.match(schema, /role_check/);
});
