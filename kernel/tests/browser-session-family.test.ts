/**
 * QOL_BROWSER_SOURCE must name an owned upstream copy with browser-session-family.patch applied.
 * Run this file alone: dependency-service doubles are process-local Bun module mocks.
 * BrowserConnection, BrowserTools, core Tool.snapshot/CodeMode execution, PluginHooks,
 * and the entire core Permission service are the actual production implementations.
 * Only persistence, agent configuration, image storage, and RPC transport are fixture doubles;
 * no permission evaluation, discovery filtering, routing, or execution logic is reimplemented.
 */
import { expect, mock, test } from "bun:test";
import { createRequire } from "node:module";
import { realpathSync } from "node:fs";
import { join } from "node:path";
import { createServer, type Socket } from "node:net";

const source = realpathSync(
  process.env.QOL_BROWSER_SOURCE ??
    (() => {
      throw new Error("Set QOL_BROWSER_SOURCE to an owned patched upstream source copy");
    })(),
);
if (!source.startsWith("/tmp/opencode/")) throw new Error("Use an owned /tmp/opencode source fixture");
const require = createRequire(join(source, "package.json"));
const { Context, Deferred, Effect, Exit, Fiber, Layer, Queue, Schema, Scope, Stream } = await import(
  require.resolve("effect")
);
const load = (file: string) => import(join(source, file));
const { makeLocationNode } = await load("packages/util/src/effect/app-node.ts");
const doubles: Record<string, any> = {};
for (const [file, name] of [
  ["agent", "Agent"],
  ["bus", "Bus"],
  ["location", "Location"],
  ["session/store", "SessionStore"],
  ["permission/saved", "PermissionSaved"],
  ["image", "Image"],
]) {
  const Service = Context.Service()(`browser-fixture/${name}`);
  const api = {
    Service,
    node: makeLocationNode({
      service: Service,
      layer: Layer.succeed(Service, {}),
      deps: [],
    }),
  };
  doubles[name] = Service;
  mock.module(join(source, `packages/core/src/${file}.ts`), () => ({
    [name]: api,
  }));
}
// Avoid loading AI provider SDKs through the barrel; use its real schema exports.
const aiSchemas = await load("packages/ai/src/schema/index.ts");
mock.module(require.resolve("@opencode/ai"), () => aiSchemas);
const { Tool } = await load("packages/core/src/tool.ts");
const { Permission } = await load("packages/core/src/permission.ts");
const { PluginHooks } = await load("packages/core/src/plugin/hooks.ts");
const { BrowserConnection } = await load("packages/plugin-browser/src/connection.ts");
const { BrowserTools } = await load("packages/plugin-browser/src/tools.ts");
const { Browser } = await load("packages/plugin-browser/src/rpc.ts");
const layers = [Tool, Permission, PluginHooks].map((api) => {
  let actual: any;
  api.node.mapLayer((layer: any) => {
    actual = layer;
    return layer;
  });
  return actual;
});
const location = {
  directory: "/browser-fixture",
  workspaceID: "wrk_browser-fixture",
  project: { id: "global" },
};
const userAllow = { action: "browser", resource: "*", effect: "allow" };
const leaseRules = (session: any) =>
  session.permissions?.filter(
    (rule: any) => rule.action === "browser" && rule.resource.startsWith("opencode.browser/lease/"),
  ) ?? [];
const tab = () => ({
  id: `tab_${crypto.randomUUID()}`,
  url: "about:blank",
  title: "fixture",
  loading: false,
  canGoBack: false,
  canGoForward: false,
  generation: 1,
});
const run = (body: (fixture: any) => any, options: { sessions?: Map<string, any>; location?: typeof location } = {}) =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const sessions = options.sessions ?? new Map<string, any>();
        const currentLocation = options.location ?? location;
        const agents = [
          { id: "build", permissions: [] },
          { id: "reviewer", permissions: [] },
        ];
        const lifecycle = yield* Queue.unbounded();
        const commands = yield* Queue.unbounded();
        const controls: any[] = [];
        const assertions: any[] = [];
        const updates: any[] = [];
        const acknowledgments = new Map<string, any>();
        const states = new Map<string, any>();
        let handlers: any;
        let autoReply = true;
        let permissionWait: any;
        let updateWait: any;
        let listWait: any;
        let barrier: any;
        const get = (sessionID: string) => Effect.sync(() => sessions.get(sessionID));
        const env = Layer.mergeAll(
          Layer.succeed(doubles.Agent, {
            resolve: () => Effect.succeed(agents[0]),
          }),
          Layer.succeed(doubles.Bus, { publish: () => Effect.void }),
          Layer.succeed(doubles.Location, currentLocation),
          Layer.succeed(doubles.SessionStore, { get }),
          Layer.succeed(doubles.PermissionSaved, {
            list: () => Effect.succeed([]),
          }),
          Layer.succeed(doubles.Image, {
            normalize: () => Effect.die("No images in this fixture"),
          }),
        );
        const actualLayers = Layer.provideMerge(Layer.mergeAll(layers[0], layers[1]), Layer.mergeAll(layers[2], env));
        yield* Effect.gen(function* () {
          const registry = yield* Tool.Service;
          const permission = yield* Permission.Service;
          const hooks = yield* PluginHooks.Service;
          const call = {
            error: (_code: string, message: string) => new Error(message),
          };
          const ctx = {
            location: currentLocation,
            agent: {
              transform: (edit: any) =>
                Effect.sync(() => {
                  edit({ list: () => agents });
                  return { dispose: Effect.void };
                }),
            },
            session: {
              get: ({ sessionID }: any) =>
                Effect.gen(function* () {
                  if (sessionID === "ses_barrier") {
                    yield* Deferred.succeed(barrier, undefined);
                    return yield* Effect.fail(new Error("Session not found"));
                  }
                  const session = yield* get(sessionID);
                  return session ? structuredClone(session) : yield* Effect.fail(new Error("Session not found"));
                }),
              update: ({ sessionID, permissions }: any) =>
                Effect.gen(function* () {
                  if (updateWait) {
                    const wait = updateWait;
                    updateWait = undefined;
                    yield* wait;
                  }
                  const session = sessions.get(sessionID);
                  if (session) {
                    updates.push({
                      sessionID,
                      before: structuredClone(session.permissions),
                      permissions: structuredClone(permissions),
                      location: structuredClone(session.location),
                    });
                    session.permissions = permissions;
                  }
                }),
              list: () =>
                Effect.gen(function* () {
                  if (listWait) {
                    const wait = listWait;
                    listWait = undefined;
                    yield* wait;
                  }
                  return { data: Array.from(sessions.values()), cursor: {} };
                }),
              hook: (name: string, callback: any) => hooks.register("session", name, callback),
            },
            tool: registry,
            permission: {
              assert: (input: any) =>
                Effect.gen(function* () {
                  assertions.push(input);
                  yield* permission
                    .assert(input)
                    .pipe(Effect.mapError((error: any) => new Tool.Error({ message: error.message })));
                  if (permissionWait) {
                    const wait = permissionWait;
                    permissionWait = undefined;
                    yield* wait;
                  }
                }),
            },
            event: { subscribe: () => Stream.fromQueue(lifecycle) },
            rpc: {
              register: (_definition: any, registered: any) =>
                Effect.sync(() => {
                  handlers = registered;
                  return {
                    events: {
                      emit: (_name: string, control: any) =>
                        Effect.gen(function* () {
                          Schema.decodeUnknownSync(Browser.Control)(control);
                          controls.push(control);
                          if (control.type === "attached") {
                            yield* Deferred.succeed(acknowledgments.get(control.connectionID), undefined);
                          }
                          if (control.type !== "command") return;
                          const ownerID = [...states].find(
                            ([, state]) => state.connectionID === control.connectionID,
                          )?.[0];
                          const command = yield* handlers.command({ sessionID: ownerID, ...control }, call);
                          yield* Queue.offer(commands, {
                            ...control,
                            ownerID,
                            command,
                          });
                          if (autoReply)
                            yield* handlers.result(
                              {
                                sessionID: ownerID,
                                ...control,
                                outcome: {
                                  type: "success",
                                  result: {
                                    value: states.get(ownerID!)?.state,
                                    files: [],
                                  },
                                },
                              },
                              call,
                            );
                        }),
                    },
                  };
                }),
            },
          };
          const browserScope = yield* Scope.make();
          const dispose = Scope.close(browserScope, Exit.void);
          yield* Effect.addFinalizer(() => dispose);
          const connection = yield* BrowserConnection.make(ctx).pipe(Scope.provide(browserScope));
          yield* BrowserTools.register(ctx, connection).pipe(Scope.provide(browserScope));
          const add = (id: string, parentID?: string, extra = {}) => {
            const session = {
              id,
              parentID,
              agent: "build",
              location: { ...currentLocation },
              permissions: structuredClone(sessions.get(parentID!)?.permissions ?? []),
              ...extra,
            };
            sessions.set(id, session);
            return session;
          };
          const prompt = (id: string) =>
            hooks.trigger("session", "prompt", {
              sessionID: id,
              messageID: "msg_fixture",
              prompt: { text: "fixture" },
              delivery: "steer",
            });
          const snapshot = (id: string) =>
            registry.snapshot([...agents[0].permissions, ...(sessions.get(id)?.permissions ?? [])]);
          const paths = (snapshot: any): string[] => {
            const walk = (items: any[], prefix = ""): string[] =>
              items.flatMap((item) =>
                item.type === "namespace" ? walk(item.tools, `${prefix}${item.name}.`) : [`${prefix}${item.name}`],
              );
            return walk(snapshot.codeModeCatalog?.tools ?? []);
          };
          const tool = (sessionID: string) => ({
            sessionID,
            agent: "build",
            messageID: "msg_fixture",
            id: "call_fixture",
            progress: () => Effect.void,
          });
          const execute = (id: string, captured?: any) =>
            Effect.gen(function* () {
              const selected = captured ?? (yield* snapshot(id));
              return yield* selected.execute({
                sessionID: id,
                agent: "build",
                messageID: "msg_fixture",
                call: {
                  type: "tool-call",
                  name: "execute",
                  id: crypto.randomUUID(),
                  input: { code: "return await tools.browser.tabs.list({})" },
                },
              });
            });
          const attach = (id: string, connectionID = crypto.randomUUID()) =>
            Effect.gen(function* () {
              const acknowledged = yield* Deferred.make();
              acknowledgments.set(connectionID, acknowledged);
              states.set(id, {
                connectionID,
                state: { tabs: [tab()], focusedTabID: null },
              });
              const fiber = yield* handlers
                .attach({ sessionID: id, connectionID }, call)
                .pipe(Effect.forkScoped({ startImmediately: true }));
              yield* Deferred.await(acknowledged);
              yield* handlers.state(structuredClone({ sessionID: id, ...states.get(id) }), call);
              return { id, connectionID, fiber };
            });
          const event = (type: string, id: string) =>
            Effect.gen(function* () {
              barrier = yield* Deferred.make();
              yield* Queue.offer(lifecycle, { type, data: { sessionID: id } });
              yield* Queue.offer(lifecycle, {
                type: "session.created",
                data: { sessionID: "ses_barrier" },
              });
              yield* Deferred.await(barrier);
            });
          yield* body({
            add,
            attach,
            prompt,
            snapshot,
            paths,
            execute,
            tool,
            event,
            sessions,
            agents,
            controls,
            assertions,
            connection,
            handlers,
            call,
            commands,
            states,
            permission,
            updates,
            dispose,
            noReply: () => {
              autoReply = false;
            },
            pausePermission: (wait: any) => {
              permissionWait = wait;
            },
            pauseUpdate: (wait: any) => {
              updateWait = wait;
            },
            pauseList: (wait: any) => {
              listWait = wait;
            },
          });
        }).pipe(Effect.provide(actualLayers));
      }),
    ),
  );

const otherLocation = { ...location, workspaceID: "wrk_browser-fixture-other" };
const twoConnections = (body: (a: any, b: any) => any, secondLocation = otherLocation) =>
  run((a) => Effect.promise(() => run((b) => body(a, b), { sessions: a.sessions, location: secondLocation })));
const dispatchesTo = (f: any, sessionID: string, parent: any) =>
  Effect.gen(function* () {
    expect(f.paths(yield* f.snapshot(sessionID))).toContain("browser.tabs.list");
    const result = yield* f.execute(sessionID);
    expect(result.output.error ? result.output.output : undefined).toBeUndefined();
    const command = yield* Queue.take(f.commands);
    expect(command.connectionID).toBe(parent.connectionID);
    expect(command.ownerID).toBe(parent.id);
  });
const echoTunnel = (f: any, parent: any) =>
  Effect.gen(function* () {
    const sockets = new Set<Socket>();
    const server = yield* Effect.acquireRelease(
      Effect.promise(
        () =>
          new Promise<ReturnType<typeof createServer>>((resolve) => {
            const server = createServer((socket) => {
              sockets.add(socket);
              socket.on("close", () => sockets.delete(socket));
              socket.pipe(socket);
            });
            server.listen(0, "127.0.0.1", () => resolve(server));
          }),
      ),
      (server) =>
        Effect.promise(
          () =>
            new Promise<void>((resolve) => {
              for (const socket of sockets) socket.destroy();
              server.close(() => resolve());
            }),
        ),
    );
    const owner = { sessionID: parent.id, connectionID: parent.connectionID };
    const tunnelID = yield* f.handlers["tunnel.open"](
      { ...owner, target: { host: "127.0.0.1", port: server.address().port } },
      f.call,
    );
    return Effect.gen(function* () {
      yield* f.handlers["tunnel.write"]({ ...owner, tunnelID, data: Buffer.from("owner-still-open") }, f.call);
      const received = yield* f.handlers["tunnel.read"]({ ...owner, tunnelID }, f.call);
      expect(Buffer.from(received.data).toString()).toBe("owner-still-open");
    });
  });

test("same-directory workspace B keeps exact grants, catalogs, dispatch and tunnels through all A cleanup", () =>
  twoConnections((a, b) =>
    Effect.gen(function* () {
      a.add("ses_a_parent");
      a.add("ses_a_child", "ses_a_parent");
      b.add("ses_b_parent");
      b.add("ses_b_child", "ses_b_parent");
      const parentB = yield* b.attach("ses_b_parent");
      const tunnelB = yield* echoTunnel(b, parentB);
      const beforeB = ["ses_b_parent", "ses_b_child"].map((id) => structuredClone(b.sessions.get(id).permissions));
      const unchangedB = Effect.gen(function* () {
        expect(["ses_b_parent", "ses_b_child"].map((id) => b.sessions.get(id).permissions)).toEqual(beforeB);
        expect(a.updates.filter((update: any) => update.sessionID.startsWith("ses_b_"))).toEqual([]);
        yield* dispatchesTo(b, "ses_b_child", parentB);
        yield* tunnelB;
      });
      const parentA = yield* a.attach("ses_a_parent");
      yield* unchangedB;
      // Foreign prompt/lifecycle notifications must not enroll B sessions as A recipients.
      yield* a.prompt("ses_b_child");
      yield* a.event("session.created", "ses_b_child");
      yield* unchangedB;
      yield* Fiber.interrupt(parentA.fiber);
      yield* unchangedB;
      yield* a.attach("ses_a_parent");
      yield* a.dispose;
      yield* unchangedB;
    }),
  ));

test("delayed old-location cleanup removes only A's moved lease after B has granted its own renderer", () =>
  twoConnections((a, b) =>
    Effect.gen(function* () {
      a.add("ses_a_parent");
      a.add("ses_moved", "ses_a_parent");
      b.add("ses_b_parent");
      b.add("ses_b_child", "ses_b_parent");
      const parentA = yield* a.attach("ses_a_parent");
      const parentB = yield* b.attach("ses_b_parent");
      const tunnelA = yield* echoTunnel(a, parentA);
      const tunnelB = yield* echoTunnel(b, parentB);
      const oldLease = leaseRules(a.sessions.get("ses_moved"))[0].resource;
      const custom = { action: "read", resource: "*", effect: "allow" };
      a.sessions.get("ses_moved").permissions.push(custom);
      a.sessions.get("ses_moved").location = { ...otherLocation };
      const entered = yield* Deferred.make();
      const release = yield* Deferred.make();
      a.pauseList(Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(release))));
      const cleaning = yield* a.event("session.moved", "ses_moved").pipe(Effect.forkScoped);
      yield* Deferred.await(entered);
      // Real session moves retain parentID. The moved session attaches its own B renderer;
      // it cannot borrow B's unrelated parent merely by moving into the workspace.
      expect(
        (yield* b.connection.target(b.tool("ses_moved"), { type: "tabs.list" }).pipe(Effect.flip)).message,
      ).toContain("browser.disconnected");
      const moved = yield* b.attach("ses_moved");
      const newLease = leaseRules(b.sessions.get("ses_moved")).find((rule: any) => rule.resource !== oldLease).resource;
      expect(newLease).not.toBe(oldLease);
      expect(leaseRules(b.sessions.get("ses_moved")).map((rule: any) => rule.resource)).toContain(oldLease);
      const beforeCleanup = structuredClone(b.sessions.get("ses_moved").permissions);
      yield* Deferred.succeed(release, undefined);
      yield* Fiber.join(cleaning);
      expect(b.sessions.get("ses_moved").permissions).toEqual(
        beforeCleanup.filter((rule: any) => rule.resource !== oldLease),
      );
      const movedWrites = a.updates.filter(
        (update: any) => update.sessionID === "ses_moved" && update.location.workspaceID === otherLocation.workspaceID,
      );
      expect(movedWrites).toHaveLength(1);
      expect(movedWrites[0].permissions).toContainEqual(custom);
      expect(movedWrites[0].permissions).toContainEqual({ action: "browser", resource: newLease, effect: "allow" });
      yield* dispatchesTo(b, "ses_moved", moved);
      yield* dispatchesTo(b, "ses_b_child", parentB);
      yield* dispatchesTo(a, "ses_a_parent", parentA);
      yield* tunnelA;
      yield* tunnelB;
      yield* a.dispose;
      expect(b.sessions.get("ses_moved").permissions).toEqual(movedWrites[0].permissions);
      yield* dispatchesTo(b, "ses_moved", moved);
      yield* tunnelB;
    }),
  ));

test("whole-permission writes are serialized across A cleanup and B attachment, not just per instance", () =>
  twoConnections((a, b) =>
    Effect.gen(function* () {
      a.add("ses_a_parent");
      a.add("ses_moved", "ses_a_parent");
      b.add("ses_b_parent");
      b.add("ses_b_child", "ses_b_parent");
      yield* a.attach("ses_a_parent");
      const parentB = yield* b.attach("ses_b_parent");
      const oldLease = leaseRules(a.sessions.get("ses_moved"))[0].resource;
      a.sessions.get("ses_moved").location = { ...otherLocation };
      const entered = yield* Deferred.make();
      const release = yield* Deferred.make();
      a.pauseUpdate(Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(release))));
      const cleaning = yield* a.event("session.moved", "ses_moved").pipe(Effect.forkScoped);
      yield* Deferred.await(entered);
      const attaching = yield* b
        .attach("ses_moved", "moved-renderer")
        .pipe(Effect.forkScoped({ startImmediately: true }));
      expect(
        b.controls.some((control: any) => control.type === "attached" && control.connectionID === "moved-renderer"),
      ).toBe(false);
      expect(leaseRules(b.sessions.get("ses_moved"))).toEqual([
        { action: "browser", resource: oldLease, effect: "allow" },
      ]);
      yield* Deferred.succeed(release, undefined);
      const moved = yield* Fiber.join(attaching);
      yield* Fiber.join(cleaning);
      expect(leaseRules(b.sessions.get("ses_moved"))).toHaveLength(1);
      expect(leaseRules(b.sessions.get("ses_moved"))[0].resource).not.toBe(oldLease);
      const before = structuredClone(b.sessions.get("ses_moved").permissions);
      yield* a.dispose;
      expect(b.sessions.get("ses_moved").permissions).toEqual(before);
      yield* dispatchesTo(b, "ses_moved", moved);
      yield* dispatchesTo(b, "ses_b_child", parentB);
    }),
  ));

test("live foreign instance leases survive even at the same location, while restarted stale copies are cleaned", () =>
  twoConnections(
    (a, b) =>
      Effect.gen(function* () {
        a.add("ses_a_parent");
        a.add("ses_a_child", "ses_a_parent");
        const parentA = yield* a.attach("ses_a_parent");
        const staleCopy = structuredClone(a.sessions.get("ses_a_child").permissions);
        b.add("ses_b_parent");
        b.add("ses_b_child", "ses_b_parent");
        const parentB = yield* b.attach("ses_b_parent");
        expect(a.sessions.get("ses_a_child").permissions).toEqual(staleCopy);
        yield* a.prompt("ses_b_child");
        yield* dispatchesTo(a, "ses_a_child", parentA);
        yield* dispatchesTo(b, "ses_b_child", parentB);
        yield* a.dispose;
        b.add("ses_stale_copy", undefined, { permissions: staleCopy });
        yield* b.prompt("ses_stale_copy");
        expect(b.sessions.get("ses_stale_copy").permissions).toEqual([]);
        expect(b.paths(yield* b.snapshot("ses_stale_copy"))).not.toContain("browser.tabs.list");
        yield* dispatchesTo(b, "ses_b_child", parentB);
      }),
    location,
  ));

test("real tool catalog enables existing/new children and grandchildren only after attachment", () =>
  run((f) =>
    Effect.gen(function* () {
      f.add("ses_parent");
      f.add("ses_child", "ses_parent");
      f.add("ses_grandchild", "ses_child");
      yield* f.prompt("ses_child");
      expect(f.paths(yield* f.snapshot("ses_child"))).not.toContain("browser.tabs.list");
      const parent = yield* f.attach("ses_parent");
      for (const id of ["ses_parent", "ses_child", "ses_grandchild"]) {
        yield* f.prompt(id);
        expect(f.paths(yield* f.snapshot(id))).toContain("browser.tabs.list");
        const result = yield* f.execute(id);
        expect(result.output.error ? result.output.output : undefined).toBeUndefined();
        expect(JSON.parse(result.output.output).tabs).toHaveLength(1);
        const command = yield* Queue.take(f.commands);
        expect(command.connectionID).toBe(parent.connectionID);
        expect(command.ownerID).toBe("ses_parent");
      }
      f.add("ses_new", "ses_child");
      yield* f.prompt("ses_new");
      expect(f.paths(yield* f.snapshot("ses_new"))).toContain("browser.tabs.list");
      expect(f.assertions.at(-1)).toMatchObject({
        sessionID: "ses_grandchild",
        agent: "build",
        action: "browser",
        source: { type: "tool", messageID: "msg_fixture" },
      });
    }),
  ));

test("authoritative same-location ancestry rejects roots, metadata, fork, broken/cyclic/deep chains", () =>
  run((f) =>
    Effect.gen(function* () {
      f.add("ses_parent");
      yield* f.attach("ses_parent");
      const denied = [
        f.add("ses_root"),
        f.add("ses_directory", "ses_parent", {
          location: { ...location, directory: "/elsewhere" },
        }),
        f.add("ses_workspace", "ses_parent", {
          location: { ...location, workspaceID: "wrk_elsewhere" },
        }),
        f.add("ses_metadata", undefined, {
          metadata: { parentID: "ses_parent" },
          fork: { sessionID: "ses_parent" },
        }),
        f.add("ses_broken", "ses_missing"),
        f.add("ses_cycle_a", "ses_cycle_b"),
        f.add("ses_cycle_b", "ses_cycle_a"),
      ];
      let parent = "ses_parent";
      for (let i = 0; i < 64; i++) {
        const id = `ses_depth_${i}`;
        f.add(id, parent);
        parent = id;
        if (i === 62) {
          yield* f.prompt(id);
          expect(f.paths(yield* f.snapshot(id))).toContain("browser.tabs.list");
        }
      }
      denied.push(f.sessions.get(parent));
      for (const session of denied) {
        yield* f.prompt(session.id);
        expect(f.paths(yield* f.snapshot(session.id))).not.toContain("browser.tabs.list");
        const failure = yield* f.connection.target(f.tool(session.id), { type: "tabs.list" }).pipe(Effect.flip);
        expect(failure.message).toContain("[browser.disconnected]");
      }
      const failure = yield* f.handlers
        .attach({ sessionID: "ses_workspace", connectionID: "wrong" }, f.call)
        .pipe(Effect.flip);
      expect(failure.message).toBe("Session belongs to another location.");
    }),
  ));

test("child own renderer wins and detach falls back to nearest live ancestor", () =>
  run((f) =>
    Effect.gen(function* () {
      f.add("ses_parent");
      f.add("ses_child", "ses_parent");
      f.add("ses_grandchild", "ses_child");
      const parent = yield* f.attach("ses_parent");
      const child = yield* f.attach("ses_child");
      yield* f.execute("ses_grandchild");
      expect((yield* Queue.take(f.commands)).connectionID).toBe(child.connectionID);
      yield* Fiber.interrupt(child.fiber);
      yield* f.execute("ses_grandchild");
      expect((yield* Queue.take(f.commands)).connectionID).toBe(parent.connectionID);
    }),
  ));

test("reserved grants are revoked including inherited copies; user allows survive; captured catalog cannot dispatch", () =>
  run((f) =>
    Effect.gen(function* () {
      f.add("ses_parent", undefined, { permissions: [userAllow] });
      const parent = yield* f.attach("ses_parent");
      f.add("ses_child", "ses_parent");
      yield* f.prompt("ses_child");
      const captured = yield* f.snapshot("ses_child");
      const stale = structuredClone(f.sessions.get("ses_child").permissions);
      yield* Fiber.interrupt(parent.fiber);
      expect(leaseRules(f.sessions.get("ses_child"))).toEqual([]);
      expect(f.sessions.get("ses_parent").permissions).toEqual([userAllow]);
      f.add("ses_inherited", "ses_parent", { permissions: stale });
      yield* f.prompt("ses_inherited");
      expect(leaseRules(f.sessions.get("ses_inherited"))).toEqual([]);
      const count = f.controls.filter((item: any) => item.type === "command").length;
      const result = yield* f.execute("ses_child", captured);
      expect(result.output.error).toBe(true);
      expect(result.output.output).toContain("browser.disconnected");
      expect(f.controls.filter((item: any) => item.type === "command")).toHaveLength(count);
    }),
  ));

test("real core permissions honor session deny after auto-grant and deny a captured snapshot", () =>
  run((f) =>
    Effect.gen(function* () {
      f.add("ses_parent");
      f.add("ses_child", "ses_parent");
      yield* f.attach("ses_parent");
      const captured = yield* f.snapshot("ses_child");
      f.sessions.get("ses_child").permissions.push({ action: "browser", resource: "*", effect: "deny" });
      yield* f.prompt("ses_child");
      expect(f.paths(yield* f.snapshot("ses_child"))).not.toContain("browser.tabs.list");
      const result = yield* f.execute("ses_child", captured);
      expect(result.output.error).toBe(true);
      expect(result.output.output).toContain("Permission denied: browser");
      expect(f.controls.filter((item: any) => item.type === "command")).toHaveLength(0);
    }),
  ));

test("disconnect hides the fresh catalog and the prompt barrier removes exact stale leases only", () =>
  run((f) =>
    Effect.gen(function* () {
      const custom = {
        action: "browser",
        resource: "opencode.browser/lease/user-named",
        effect: "deny",
      };
      f.add("ses_parent");
      f.add("ses_child", "ses_parent", { permissions: [custom] });
      const parent = yield* f.attach("ses_parent");
      const stale = structuredClone(f.sessions.get("ses_child").permissions);
      yield* Fiber.interrupt(parent.fiber);
      yield* f.prompt("ses_child");
      // A scoped user rule may retain discovery; the browser's server-owned allow is gone.
      expect(f.sessions.get("ses_child").permissions).toEqual([custom]);
      f.add("ses_inherited", "ses_parent", {
        permissions: stale.filter((rule: any) => rule !== custom && rule.effect === "allow"),
      });
      yield* f.prompt("ses_inherited");
      expect(f.paths(yield* f.snapshot("ses_inherited"))).not.toContain("browser.tabs.list");
      expect(f.sessions.get("ses_inherited").permissions).toEqual([]);
    }),
  ));

test("replacement retains new grants, invalidates old selected actions and old finalizers", () =>
  run((f) =>
    Effect.gen(function* () {
      f.add("ses_parent");
      f.add("ses_child", "ses_parent");
      const old = yield* f.attach("ses_parent");
      const selected = yield* f.connection.target(f.tool("ses_child"), {
        type: "tabs.list",
      });
      const oldLease = leaseRules(f.sessions.get("ses_child"))[0].resource;
      const next = yield* f.attach("ses_parent");
      yield* Fiber.join(old.fiber);
      const newLease = leaseRules(f.sessions.get("ses_child"))[0].resource;
      expect(newLease).not.toBe(oldLease);
      expect(leaseRules(f.sessions.get("ses_child"))).toHaveLength(1);
      expect((yield* selected.request([]).pipe(Effect.flip)).message).toMatch(
        /Permission denied|selected browser route/,
      );
      yield* f.execute("ses_child");
      expect((yield* Queue.take(f.commands)).connectionID).toBe(next.connectionID);
      expect(leaseRules(f.sessions.get("ses_child"))[0].resource).toBe(newLease);
    }),
  ));

test("replacement during blocked old cleanup serializes writes without deleting the new lease", () =>
  run((f) =>
    Effect.gen(function* () {
      f.add("ses_parent");
      f.add("ses_child", "ses_parent");
      const old = yield* f.attach("ses_parent");
      const entered = yield* Deferred.make();
      const release = yield* Deferred.make();
      f.pauseUpdate(Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(release))));
      const cleanup = yield* Fiber.interrupt(old.fiber).pipe(Effect.forkScoped({ startImmediately: true }));
      yield* Deferred.await(entered);
      const attaching = yield* f.attach("ses_parent").pipe(Effect.forkScoped({ startImmediately: true }));
      yield* Deferred.succeed(release, undefined);
      const next = yield* Fiber.join(attaching);
      yield* Fiber.join(cleanup);
      expect(leaseRules(f.sessions.get("ses_child"))).toHaveLength(1);
      expect(leaseRules(f.sessions.get("ses_child"))[0].resource).toBe(
        leaseRules(f.sessions.get("ses_parent"))[0].resource,
      );
      yield* f.execute("ses_child");
      expect((yield* Queue.take(f.commands)).connectionID).toBe(next.connectionID);
    }),
  ));

test("replacement while permission waits rejects the old selection rather than retargeting", () =>
  run((f) =>
    Effect.gen(function* () {
      f.add("ses_parent");
      f.add("ses_child", "ses_parent");
      yield* f.attach("ses_parent");
      const selected = yield* f.connection.target(f.tool("ses_child"), {
        type: "tabs.list",
      });
      const entered = yield* Deferred.make();
      const release = yield* Deferred.make();
      f.pausePermission(Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(release))));
      const pending = yield* selected.request([]).pipe(Effect.forkScoped);
      yield* Deferred.await(entered);
      yield* f.attach("ses_parent");
      yield* Deferred.succeed(release, undefined);
      expect((yield* Fiber.join(pending).pipe(Effect.flip)).message).toContain("selected browser route or tab changed");
      expect(f.controls.filter((item: any) => item.type === "command")).toHaveLength(0);
    }),
  ));

test("permission wait and document generation changes never retarget selected actions", () =>
  run((f) =>
    Effect.gen(function* () {
      f.add("ses_parent");
      f.add("ses_child", "ses_parent");
      yield* f.attach("ses_parent");
      const state = f.states.get("ses_parent");
      const selected = yield* f.connection.target(f.tool("ses_child"), {
        type: "snapshot",
        tabID: state.state.tabs[0].id,
      });
      const entered = yield* Deferred.make();
      const release = yield* Deferred.make();
      f.pausePermission(Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(release))));
      const fiber = yield* selected.request([]).pipe(Effect.forkScoped);
      yield* Deferred.await(entered);
      state.state.tabs[0].generation++;
      yield* f.handlers.state({ sessionID: "ses_parent", ...state }, f.call);
      yield* Deferred.succeed(release, undefined);
      const failure = yield* Fiber.join(fiber).pipe(Effect.flip);
      expect(failure.message).toContain("selected browser route or tab changed");
      expect(f.controls.filter((item: any) => item.type === "command")).toHaveLength(0);
    }),
  ));

test("an interrupted route cannot revive an old selection after the next prompt restores access", () =>
  run((f) =>
    Effect.gen(function* () {
      f.add("ses_parent");
      f.add("ses_child", "ses_parent");
      f.add("ses_grandchild", "ses_child");
      yield* f.attach("ses_parent");
      const selected = yield* f.connection.target(f.tool("ses_grandchild"), { type: "tabs.list" });
      yield* f.event("session.execution.interrupted", "ses_child");
      yield* f.prompt("ses_child");
      yield* f.prompt("ses_grandchild");
      expect((yield* selected.request([]).pipe(Effect.flip)).message).toContain(
        "selected browser route or tab changed",
      );
      expect(f.controls.filter((item: any) => item.type === "command")).toHaveLength(0);
      const fresh = yield* f.execute("ses_grandchild");
      expect(fresh.output.error).toBeUndefined();
    }),
  ));

for (const kind of ["session.execution.interrupted", "session.moved", "session.deleted"]) {
  test(`${kind} on an intermediate borrower cancels descendants without closing parent renderer/tunnels`, () =>
    run((f) =>
      Effect.gen(function* () {
        f.add("ses_parent");
        f.add("ses_child", "ses_parent");
        f.add("ses_grandchild", "ses_child");
        const parent = yield* f.attach("ses_parent");
        const sockets = new Set<Socket>();
        const server = yield* Effect.acquireRelease(
          Effect.promise(
            () =>
              new Promise<ReturnType<typeof createServer>>((resolve) => {
                const server = createServer((socket) => {
                  sockets.add(socket);
                  socket.on("close", () => sockets.delete(socket));
                  socket.pipe(socket);
                });
                server.listen(0, "127.0.0.1", () => resolve(server));
              }),
          ),
          (server) =>
            Effect.promise(
              () =>
                new Promise<void>((resolve) => {
                  for (const socket of sockets) socket.destroy();
                  server.close(() => resolve());
                }),
            ),
        );
        const address = server.address();
        const owner = { sessionID: "ses_parent", connectionID: parent.connectionID };
        const tunnelID = yield* f.handlers["tunnel.open"](
          { ...owner, target: { host: "127.0.0.1", port: address.port } },
          f.call,
        );
        const target = yield* f.connection.target(f.tool("ses_grandchild"), {
          type: "tabs.list",
        });
        f.noReply();
        const pending = yield* target.request([]).pipe(Effect.forkScoped);
        const command = yield* Queue.take(f.commands);
        if (kind === "session.moved") f.sessions.get("ses_child").location.directory = "/elsewhere";
        if (kind === "session.deleted") f.sessions.delete("ses_child");
        yield* f.event(kind, "ses_child");
        expect((yield* Fiber.join(pending).pipe(Effect.flip)).message).toContain("browser.cancelled");
        expect(f.controls).toContainEqual({
          type: "cancel",
          connectionID: parent.connectionID,
          requestID: command.requestID,
        });
        expect(leaseRules(f.sessions.get("ses_grandchild"))).toEqual([]);
        // A real pre-existing parent TCP tunnel remains open through borrower cleanup.
        yield* f.handlers["tunnel.write"]({ ...owner, tunnelID, data: Buffer.from("still-open") }, f.call);
        const received = yield* f.handlers["tunnel.read"]({ ...owner, tunnelID }, f.call);
        expect(Buffer.from(received.data).toString()).toBe("still-open");
        yield* f.handlers["tunnel.close"]({ ...owner, tunnelID }, f.call);
        const alias = yield* f.handlers["tunnel.close"](
          { ...owner, sessionID: "ses_grandchild", tunnelID },
          f.call,
        ).pipe(Effect.flip);
        expect(alias.message).toContain("attachment is unavailable");
        const own = yield* f.connection.target(f.tool("ses_parent"), {
          type: "tabs.list",
        });
        const fiber = yield* own.request([]).pipe(Effect.forkScoped);
        const next = yield* Queue.take(f.commands);
        expect(next.connectionID).toBe(parent.connectionID);
        yield* f.handlers.result(
          {
            sessionID: "ses_parent",
            ...next,
            outcome: {
              type: "success",
              result: { value: f.states.get("ses_parent").state, files: [] },
            },
          },
          f.call,
        );
        yield* Fiber.join(fiber);
        if (kind === "session.execution.interrupted") {
          yield* f.prompt("ses_child");
          expect(leaseRules(f.sessions.get("ses_child"))).toHaveLength(1);
        }
      }),
    ));
}
