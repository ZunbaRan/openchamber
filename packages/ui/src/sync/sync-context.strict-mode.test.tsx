import { describe, expect, mock, test } from "bun:test"
import type { Message, OpencodeClient, Part } from "@opencode-ai/sdk/v2/client"
import React, { StrictMode, useEffect } from "react"
import { act } from "react"
import { createRoot } from "react-dom/client"
import type { StoreApi } from "zustand"
import type { DirectoryStore } from "./child-store"
import type { SessionMessageLoader } from "./session-message-loader"

type FakeNode = {
  nodeType: number
  nodeName: string
  tagName: string
  ownerDocument: FakeDocument
  parentNode: FakeNode | null
  childNodes: FakeNode[]
  [key: string]: unknown
}

type FakeDocument = FakeNode & {
  defaultView: FakeWindow
  body: FakeNode
  documentElement: FakeNode
  createElement(tag: string): FakeNode
}

type FakeWindow = {
  document: FakeDocument
  navigator: { userAgent: string; platform: string; maxTouchPoints: number }
  addEventListener(): void
  removeEventListener(): void
  HTMLIFrameElement: unknown
}

const createFakeNode = (tag: string, ownerDocument: FakeDocument): FakeNode => {
  const node: FakeNode = {
    nodeType: 1,
    nodeName: tag.toUpperCase(),
    tagName: tag.toUpperCase(),
    ownerDocument,
    parentNode: null,
    childNodes: [],
    addEventListener() {},
    removeEventListener() {},
    appendChild(child: FakeNode) {
      node.childNodes.push(child)
      child.parentNode = node
      return child
    },
    insertBefore(child: FakeNode, reference: FakeNode) {
      const index = node.childNodes.indexOf(reference)
      if (index < 0) node.childNodes.push(child)
      else node.childNodes.splice(index, 0, child)
      child.parentNode = node
      return child
    },
    removeChild(child: FakeNode) {
      const index = node.childNodes.indexOf(child)
      if (index >= 0) node.childNodes.splice(index, 1)
      child.parentNode = null
      return child
    },
  }
  return node
}

const installDomStub = () => {
  const document = {
    nodeType: 9,
    nodeName: "#document",
    tagName: "#document",
    parentNode: null,
    childNodes: [],
    addEventListener() {},
    removeEventListener() {},
  } as unknown as FakeDocument
  document.createElement = (tag) => createFakeNode(tag, document)
  document.body = createFakeNode("body", document)
  document.documentElement = createFakeNode("html", document)
  document.defaultView = {
    document,
    navigator: { userAgent: "test", platform: "test", maxTouchPoints: 0 },
    addEventListener() {},
    removeEventListener() {},
    HTMLIFrameElement: class {},
  }

  const globals = globalThis as unknown as {
    document?: FakeDocument
    window?: FakeWindow
    navigator?: FakeWindow["navigator"]
    IS_REACT_ACT_ENVIRONMENT?: boolean
  }
  const previous = {
    document: globals.document,
    window: globals.window,
    navigator: globals.navigator,
    actEnvironment: globals.IS_REACT_ACT_ENVIRONMENT,
  }
  globals.document = document
  globals.window = document.defaultView
  globals.navigator = document.defaultView.navigator
  globals.IS_REACT_ACT_ENVIRONMENT = true

  return {
    document,
    restore() {
      globals.document = previous.document
      globals.window = previous.window
      globals.navigator = previous.navigator
      globals.IS_REACT_ACT_ENVIRONMENT = previous.actEnvironment
    },
  }
}

mock.module("./bootstrap", () => ({
  bootstrapGlobal: async () => undefined,
  bootstrapDirectory: async () => "complete" as const,
}))

mock.module("./event-pipeline", () => ({
  createEventPipeline: () => ({
    reconnect() {},
    cleanup() {},
  }),
}))

mock.module("./persist-cache", () => ({
  readDirCache: () => ({}),
  persistVcs() {},
  persistProjectMeta() {},
  persistIcon() {},
  persistSessions() {},
}))

mock.module("./session-actions", () => ({
  getSessionLastAssistantModel: () => null,
  setActionRefs() {},
}))

mock.module("./session-deletion-cleanup", () => ({
  cleanupPersistedSessionState() {},
}))

mock.module("./session-event-router", () => ({
  applySessionEventToGlobalSessions() {},
}))

mock.module("./session-navigation", () => ({
  openSessionFromToast() {},
}))

mock.module("./permission-toast", () => ({
  getPermissionToastKey: () => null,
  showPermissionNeededToast: () => false,
}))

mock.module("./notification-store", () => ({
  appendNotification() {},
}))

mock.module("./sync-refs", () => ({
  setSyncRefs() {},
  getAllSyncSessions: () => [],
  getAllSyncSessionMap: () => new Map(),
}))

mock.module("@/components/ui", () => ({
  toast: {
    info() {},
    dismiss() {},
  },
}))

mock.module("@/lib/opencode/client", () => ({
  opencodeClient: {
    getDirectory: () => "",
    getScopedSdkClient: () => ({
      session: { list: async () => ({ data: [] }) },
    }),
  },
}))

mock.module("@/stores/permissionStore", () => ({
  usePermissionStore: {
    getState: () => ({
      hydrate: async () => undefined,
    }),
  },
}))

mock.module("@/stores/useTodosPersistStore", () => ({
  useTodosPersistStore: {
    getState: () => ({
      setSessionTodos() {},
    }),
  },
}))

const configState = {
  settingsMessageStreamTransport: "auto" as const,
  hasEverConnected: false,
}
const useConfigStore = Object.assign(
  <T,>(selector: (state: typeof configState) => T) => selector(configState),
  {
    getState: () => configState,
    setState: (patch: Partial<typeof configState>) => Object.assign(configState, patch),
  },
)

mock.module("@/stores/useConfigStore", () => ({ useConfigStore }))

mock.module("@/lib/runtime-switch", () => ({
  getActiveRelayTunnel: () => null,
  getRuntimeApiBaseUrl: () => "",
  getRuntimeKey: () => "runtime-test",
  initializeRuntimeEndpoint() {},
  switchRuntimeEndpoint() {},
  subscribeRuntimeEndpointChanged: () => () => undefined,
  subscribeRuntimeEndpointWillChange: () => () => undefined,
}))

mock.module("@/lib/runtimeSurface", () => ({
  isMobileSurfaceRuntime: () => false,
}))

const createRecord = (sessionID: string) => ({
  info: {
    id: "message-1",
    sessionID,
    role: "user",
    time: { created: 1 },
  } as Message,
  parts: [{
    id: "part-1",
    messageID: "message-1",
    sessionID,
    type: "text",
    text: "hello",
  }] as Part[],
})

describe("SyncProvider StrictMode lifecycle", () => {
  test("keeps session message loading ready after effect cleanup and setup reuse refs", async () => {
    const dom = installDomStub()
    const target = { directory: "/repo", sessionID: "session-a" }
    const effectLoaders: SessionMessageLoader[] = []
    const effectStores: StoreApi<DirectoryStore>[] = []
    const loadPromises: Promise<void>[] = []
    let messageCalls = 0
    const sdk = {
      session: {
        messages: async () => {
          messageCalls += 1
          return {
            data: [createRecord(target.sessionID)],
            response: { headers: { get: () => null } },
          }
        },
      },
    } as unknown as OpencodeClient
    const { SyncProvider, useDirectoryStore, useSessionMessageLoader } = await import("./sync-context")
    let mounted = true

    const Probe = () => {
      const loader = useSessionMessageLoader()
      const store = useDirectoryStore(target.directory, { bootstrap: false })
      useEffect(() => {
        effectLoaders.push(loader)
        effectStores.push(store)
        queueMicrotask(() => {
          loadPromises.push(loader.ensure(target, { reason: "reactive" }))
        })
      }, [loader, store])
      return null
    }

    const root = createRoot(dom.document.createElement("div") as unknown as Element)
    try {
      await act(async () => {
        root.render(
          <StrictMode>
            <SyncProvider sdk={sdk} directory="">
              <Probe />
            </SyncProvider>
          </StrictMode>,
        )
        await Promise.resolve()
      })
      await Promise.all(loadPromises)

      expect(effectLoaders.length).toBeGreaterThanOrEqual(2)
      expect(new Set(effectLoaders).size).toBe(1)
      expect(new Set(effectStores).size).toBe(1)
      const activeLoader = effectLoaders[effectLoaders.length - 1]
      const activeStore = effectStores[effectStores.length - 1]
      if (!activeLoader || !activeStore) throw new Error("StrictMode effects did not expose sync resources")
      expect(messageCalls).toBe(1)
      expect(activeLoader.getSnapshot(target).status).toBe("ready")
      expect(activeStore.getState().message[target.sessionID]?.length).toBe(1)

      await act(async () => {
        root.unmount()
      })
      mounted = false
      await Promise.resolve()

      const afterUnmountTarget = { ...target, sessionID: "session-after-unmount" }
      await activeLoader.ensure(afterUnmountTarget, { reason: "reactive" })
      expect(messageCalls).toBe(1)
    } finally {
      if (mounted) {
        await act(async () => {
          root.unmount()
        })
        await Promise.resolve()
      }
      dom.restore()
    }
  })
})
