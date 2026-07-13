import { describe, expect, it } from "vitest";

import { buildGatePlan, classifyWorkflowScope } from "../../src/workflow/index.js";

describe("workflow gate policy", () => {
  it("does not schedule design or operational gates for non-UI code", () => {
    const scope = classifyWorkflowScope({
      requestText: "Refactor the TypeScript parser and add unit tests",
      explicitScope: "non-ui",
      figmaUrls: [],
    });
    const plan = buildGatePlan(scope);

    expect(plan.find((gate) => gate.id === "functional")?.applicability).toBe("required");
    expect(plan.find((gate) => gate.id === "visual")?.applicability).toBe("not-applicable");
    expect(plan.find((gate) => gate.id === "accessibility")?.applicability).toBe("not-applicable");
    expect(plan.find((gate) => gate.id === "performance")?.applicability).toBe("opt-in");
    expect(plan.find((gate) => gate.id === "observability")?.applicability).toBe("opt-in");
  });

  it("requires visual and accessibility evidence for Figma-backed UI scope", () => {
    const scope = classifyWorkflowScope({
      requestText: "Implement the checkout screen from Figma using the OpenAPI contract",
      explicitScope: "auto",
      figmaUrls: ["https://www.figma.com/design/abc/file"],
    });
    const plan = buildGatePlan(scope);

    expect(scope).toMatchObject({ ui: true, api: true, hasVisualBaseline: true });
    expect(plan.find((gate) => gate.id === "visual")?.applicability).toBe("required");
    expect(plan.find((gate) => gate.id === "accessibility")?.applicability).toBe("required");
    expect(plan.find((gate) => gate.id === "performance")?.applicability).toBe("conditional");
  });

  it("makes observability required only when explicitly requested", () => {
    const scope = classifyWorkflowScope({
      requestText: "Add trace correlation and observability to the API flow",
      explicitScope: "non-ui",
      figmaUrls: [],
    });
    const plan = buildGatePlan(scope);

    expect(plan.find((gate) => gate.id === "observability")?.applicability).toBe("required");
  });

  it("classifies Korean and plain design requests without relying on ASCII word boundaries", () => {
    expect(
      classifyWorkflowScope({
        requestText: "결제 화면 디자인과 API 스키마를 개선해줘",
        explicitScope: "auto",
      }),
    ).toMatchObject({ ui: true, api: true });

    expect(
      classifyWorkflowScope({
        requestText: "Improve the checkout design",
        explicitScope: "auto",
      }).ui,
    ).toBe(true);
  });
});
