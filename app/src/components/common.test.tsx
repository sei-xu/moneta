import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatusBadge, Tile } from "./common";

describe("StatusBadge", () => {
  // The queue states are distinguished by colour, so each one has to carry a
  // text label too — colour alone fails for colourblind and print readers.
  it.each([
    ["pending", "Aguardando processamento"],
    ["waiting_user", "Esperando você"],
    ["done", "Processado"],
    ["discarded", "Descartado"],
    ["error", "Erro"],
  ])("labels %s in words", (status, label) => {
    render(<StatusBadge status={status} />);
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it("shows an unknown status verbatim rather than blank", () => {
    render(<StatusBadge status="something_new" />);
    expect(screen.getByText("something_new")).toBeInTheDocument();
  });

  it("marks the colour dot as decorative", () => {
    const { container } = render(<StatusBadge status="pending" />);
    expect(container.querySelector(".dot")).toHaveAttribute("aria-hidden", "true");
  });
});

describe("Tile", () => {
  it("renders label and value, and omits the sub line when absent", () => {
    const { container } = render(<Tile label="Total no mês" value="R$ 10,00" />);
    expect(screen.getByText("Total no mês")).toBeInTheDocument();
    expect(screen.getByText("R$ 10,00")).toBeInTheDocument();
    expect(container.querySelector(".sub")).toBeNull();
  });

  it("renders the sub line when given", () => {
    render(<Tile label="Taxa" value="98%" sub="últimos 30 dias" />);
    expect(screen.getByText("últimos 30 dias")).toBeInTheDocument();
  });
});
