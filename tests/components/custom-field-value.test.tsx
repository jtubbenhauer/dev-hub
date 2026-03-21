import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { CustomFieldValue } from "@/components/tasks/task-detail-panel";
import type { ClickUpCustomField } from "@/types";

function field(overrides: Partial<ClickUpCustomField>): ClickUpCustomField {
  return { id: "f1", name: "Field", type: "text", value: null, ...overrides };
}

describe("CustomFieldValue", () => {
  describe("percentage / progress fields", () => {
    it("renders percent_completed as percentage", () => {
      render(
        <CustomFieldValue
          field={field({
            type: "automatic_progress",
            value: { current: "95", percent_completed: 0.95 },
          })}
        />,
      );
      expect(screen.getByText("95%")).toBeInTheDocument();
    });

    it("renders 0% for percent_completed of 0", () => {
      render(
        <CustomFieldValue
          field={field({
            type: "manual_progress",
            value: { current: "0", percent_completed: 0 },
          })}
        />,
      );
      expect(screen.getByText("0%")).toBeInTheDocument();
    });

    it("falls back to current when percent_completed is missing", () => {
      render(
        <CustomFieldValue
          field={field({
            type: "automatic_progress",
            value: { current: "50", percent_completed: undefined },
          })}
        />,
      );
      expect(screen.getByText("50%")).toBeInTheDocument();
    });

    it("renders 100% for fully complete", () => {
      render(
        <CustomFieldValue
          field={field({
            type: "manual_progress",
            value: { current: "100", percent_completed: 1 },
          })}
        />,
      );
      expect(screen.getByText("100%")).toBeInTheDocument();
    });

    it("rounds fractional percentages", () => {
      render(
        <CustomFieldValue
          field={field({
            type: "automatic_progress",
            value: { current: "33", percent_completed: 0.3333 },
          })}
        />,
      );
      expect(screen.getByText("33%")).toBeInTheDocument();
    });
  });

  describe("default fallback", () => {
    it("renders string values without JSON quotes", () => {
      render(
        <CustomFieldValue
          field={field({ type: "unknown_type", value: "505" })}
        />,
      );
      expect(screen.getByText("505")).toBeInTheDocument();
      expect(screen.queryByText('"505"')).not.toBeInTheDocument();
    });

    it("renders non-string values as JSON", () => {
      render(
        <CustomFieldValue
          field={field({ type: "unknown_type", value: { foo: "bar" } })}
        />,
      );
      expect(screen.getByText('{"foo":"bar"}')).toBeInTheDocument();
    });
  });

  describe("null / empty values", () => {
    it("renders dash for null value", () => {
      render(<CustomFieldValue field={field({ value: null })} />);
      expect(screen.getByText("—")).toBeInTheDocument();
    });

    it("renders dash for empty string value", () => {
      render(<CustomFieldValue field={field({ value: "" })} />);
      expect(screen.getByText("—")).toBeInTheDocument();
    });
  });
});
