import assert from "node:assert/strict";
import test from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  AgentClientProvider,
  useAgentClient,
} from "../../lib/AgentClientProvider.js";
import { HttpAgentClient } from "../../lib/agent.js";

test("supplies an injected AgentClient to descendants", () => {
  const fakeClient = new HttpAgentClient("http://test.invalid");
  let received: unknown;

  function Consumer() {
    received = useAgentClient();
    return createElement("span", null, "ready");
  }

  const markup = renderToStaticMarkup(
    createElement(
      AgentClientProvider,
      { client: fakeClient },
      createElement(Consumer),
    ),
  );
  assert.equal(markup, "<span>ready</span>");
  assert.equal(received, fakeClient);
});

test("rejects consumers outside a provider", () => {
  function Consumer() {
    useAgentClient();
    return null;
  }
  assert.throws(
    () => renderToStaticMarkup(createElement(Consumer)),
    /must be used within AgentClientProvider/,
  );
});
