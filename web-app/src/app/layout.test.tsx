import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import RootLayout, { metadata } from "./layout";
import React from "react";

describe("RootLayout", () => {
  it("renders children correctly within the body", () => {
    const { getByText } = render(
      <RootLayout>
        <div data-testid="child">Hello World</div>
      </RootLayout>
    );

    expect(getByText("Hello World")).toBeInTheDocument();
  });

  it("applies the antialiased class to the body", () => {
    render(
      <RootLayout>
        <div data-testid="child-content">TempoFlow Content</div>
      </RootLayout>
    );

    const body = document.querySelector("body");

    expect(body).toHaveClass("antialiased");
  });

  it("exports the correct metadata", () => {
    expect(metadata.title).toBe("Tempoflow");
    expect(metadata.description).toContain("AI-powered dance coach");
  });

  it("sets the language attribute to English on the document", () => {
    render(
      <RootLayout>
        <div />
      </RootLayout>
    );
    
    // Check the global document element since JSDOM 
    // hoists the <html> attributes from the component
    const htmlElement = document.documentElement;
    expect(htmlElement).toHaveAttribute("lang", "en");
  });
});
