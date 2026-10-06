import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { ImageViewer } from "@/components/editor/image-viewer";

describe("ImageViewer", () => {
  it("renders the image from the raw file endpoint", () => {
    render(<ImageViewer workspaceId="ws-1" filePath="assets/my logo.png" />);

    const image = screen.getByRole("img", { name: "my logo.png" });
    expect(image).toHaveAttribute(
      "src",
      "/api/files/raw?workspaceId=ws-1&path=assets%2Fmy+logo.png",
    );
  });

  it("explains when the image cannot be loaded", () => {
    render(<ImageViewer workspaceId="ws-1" filePath="assets/broken.png" />);

    fireEvent.error(screen.getByTestId("image-viewer"));

    expect(
      screen.getByText("Could not load image: broken.png"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("image-viewer")).not.toBeInTheDocument();
  });

  it("shows the next image after a previous one failed to load", () => {
    const { rerender } = render(
      <ImageViewer workspaceId="ws-1" filePath="assets/broken.png" />,
    );
    fireEvent.error(screen.getByTestId("image-viewer"));

    rerender(<ImageViewer workspaceId="ws-1" filePath="assets/logo.png" />);

    expect(screen.getByRole("img", { name: "logo.png" })).toBeInTheDocument();
  });
});
