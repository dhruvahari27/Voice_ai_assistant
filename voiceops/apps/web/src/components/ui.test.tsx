import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { DemoNote, OutcomeBadge } from "./ui";

describe("ui", () => {
  it("labels outcomes in plain words", () => {
    render(<OutcomeBadge outcome="handoff" />);
    expect(screen.getByText("Handed to staff")).toBeInTheDocument();
  });
  it("says when numbers come from demo data", () => {
    render(<DemoNote share={1} />);
    expect(screen.getByText(/demo data/)).toBeInTheDocument();
  });
});
