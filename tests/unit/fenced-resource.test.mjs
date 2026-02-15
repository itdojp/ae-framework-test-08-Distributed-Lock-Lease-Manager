import test from "node:test";
import assert from "node:assert/strict";

import { FencedResourceStore, LeaseManagerError } from "../../src/index.mjs";

test("FencedResource: 新しいtokenのみ更新を受理する", () => {
  const store = new FencedResourceStore();

  const first = store.update({
    resourceKey: "order:100",
    value: { status: "draft" },
    fencingToken: 1,
    actor: "workerA"
  });
  assert.equal(first.lastFencingToken, 1);

  const second = store.update({
    resourceKey: "order:100",
    value: { status: "confirmed" },
    fencingToken: 2,
    actor: "workerB"
  });
  assert.equal(second.lastFencingToken, 2);
  assert.equal(second.actor, "workerB");
});

test("FencedResource: 古いtoken/同一tokenは拒否する", () => {
  const store = new FencedResourceStore();
  store.update({
    resourceKey: "order:101",
    value: { step: 1 },
    fencingToken: 10,
    actor: "workerA"
  });

  assert.throws(
    () =>
      store.update({
        resourceKey: "order:101",
        value: { step: 0 },
        fencingToken: 9,
        actor: "workerB"
      }),
    /** @param {unknown} err */ (err) => err instanceof LeaseManagerError && err.code === "STALE_FENCING_TOKEN"
  );

  assert.throws(
    () =>
      store.update({
        resourceKey: "order:101",
        value: { step: 10 },
        fencingToken: 10,
        actor: "workerC"
      }),
    /** @param {unknown} err */ (err) => err instanceof LeaseManagerError && err.code === "STALE_FENCING_TOKEN"
  );
});

test("FencedResource: 無効な入力は400で拒否する", () => {
  const store = new FencedResourceStore();

  assert.throws(
    () =>
      store.update({
        resourceKey: "",
        value: {},
        fencingToken: 1,
        actor: "workerA"
      }),
    /** @param {unknown} err */ (err) => err instanceof LeaseManagerError && err.status === 400
  );

  assert.throws(
    () =>
      store.update({
        resourceKey: "order:102",
        value: {},
        fencingToken: 0,
        actor: "workerA"
      }),
    /** @param {unknown} err */ (err) => err instanceof LeaseManagerError && err.status === 400
  );
});
