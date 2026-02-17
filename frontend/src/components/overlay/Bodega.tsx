import { useEffect, useRef, useState } from "react";
import { useSaveSceneSlot } from "../../hooks/useScene";
import type { DecorationConfig } from "../../lib/scene-types";
import { useIslandStore } from "../../store/island";
import { useApi } from "../../hooks/useApi";
import { isSupportedScanChain } from "../../three/helpers/constants";
import { isAddress } from "viem";

const MAX_IMAGE_BYTES = 1_500_000;

async function fileToDataUrl(file: File): Promise<string> {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Failed to read image"));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(file);
  });
}

export function Bodega() {
  const [imageSource, setImageSource] = useState<string>("");
  const [statusMessage, setStatusMessage] = useState<string>("");
  const [linkInput, setLinkInput] = useState<string>("");

  const fileInputRef = useRef<HTMLInputElement>(null);

  const showBodega = useIslandStore((state) => state.showBodega);
  const selectedChain = useIslandStore((state) => state.selectedChain);
  const selectedCa = useIslandStore((state) => state.selectedCa);
  const selectedSlotId = useIslandStore((state) => state.selectedSlotId);
  const setBodegaOpen = useIslandStore((state) => state.setBodegaOpen);
  const supportedChain = selectedChain
    ? isSupportedScanChain(selectedChain)
    : false;
  const validAddress = selectedCa ? isAddress(selectedCa) : false;

  const saveSceneSlot = useSaveSceneSlot();
  const { walletAddress } = useApi();

  useEffect(() => {
    if (!showBodega) {
      setImageSource("");
      setStatusMessage("");
      setLinkInput("");
    }
  }, [showBodega]);

  if (!showBodega) {
    return null;
  }

  return (
    <aside className="pointer-events-auto fixed inset-0 z-40 flex justify-end bg-black/45">
      <div className="h-full w-full max-w-xl border-l border-white/10 bg-[#0a1f15] p-5 shadow-2xl">
        <header className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="font-display text-2xl text-zinc-100">Place Image</h2>
            <p className="text-xs text-zinc-400">
              Selected slot: {selectedSlotId ?? "None"}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setBodegaOpen(false)}
            className="rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-sm text-zinc-100"
          >
            Close
          </button>
        </header>

        <div className="space-y-4">
          {!supportedChain ? (
            <div className="rounded-xl border border-amber-300/30 bg-amber-500/10 p-4 text-sm text-amber-100">
              Cloud sync is currently enabled for Base and Ethereum bungalows.
              You can still place images locally on this device.
            </div>
          ) : null}
          {supportedChain && !validAddress ? (
            <div className="rounded-xl border border-amber-300/30 bg-amber-500/10 p-4 text-sm text-amber-100">
              This bungalow does not have a valid EVM token address yet, so cloud
              sync may fail. Local placement still works.
            </div>
          ) : null}

          <div className="rounded-xl border border-white/10 bg-[#112a1d] p-4">
            <p className="text-sm text-zinc-200">1. Pick image from device</p>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              className="hidden"
              onChange={async (event) => {
                const file = event.target.files?.[0];
                if (!file) return;

                if (file.size > MAX_IMAGE_BYTES) {
                  setStatusMessage("Image too large. Keep it under 1.5MB.");
                  return;
                }

                const src = await fileToDataUrl(file);
                setImageSource(src);
                setStatusMessage(`Loaded ${file.name}`);
              }}
            />
            <button
              type="button"
              className="mt-3 rounded-lg bg-emerald-500/25 px-3 py-2 text-sm font-semibold text-emerald-100"
              onClick={() => fileInputRef.current?.click()}
            >
              Choose Image
            </button>

            <div
              className="mt-3 rounded-lg border border-emerald-300/20 bg-black/20 px-3 py-2 text-xs text-zinc-300"
              onPaste={async (event) => {
                const items = event.clipboardData?.items;
                if (!items?.length) return;

                for (const item of items) {
                  if (item.kind === "file" && item.type.startsWith("image/")) {
                    const file = item.getAsFile();
                    if (!file) continue;
                    if (file.size > MAX_IMAGE_BYTES) {
                      setStatusMessage("Pasted image is too large. Keep it under 1.5MB.");
                      return;
                    }
                    const src = await fileToDataUrl(file);
                    setImageSource(src);
                    setStatusMessage("Pasted image from clipboard.");
                    return;
                  }
                }

                const text = event.clipboardData.getData("text/plain").trim();
                if (text.startsWith("http://") || text.startsWith("https://") || text.startsWith("data:image/")) {
                  setImageSource(text);
                  setLinkInput(text);
                  setStatusMessage("Using pasted image URL.");
                }
              }}
            >
              Paste an image or image URL here (Ctrl/Cmd + V)
            </div>

            <div className="mt-3 flex gap-2">
              <input
                value={linkInput}
                onChange={(event) => setLinkInput(event.target.value)}
                placeholder="https://... (optional image URL)"
                className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-xs text-zinc-100"
              />
              <button
                type="button"
                className="rounded-lg border border-emerald-200/25 bg-emerald-500/20 px-3 py-2 text-xs font-semibold text-emerald-100"
                onClick={() => {
                  const normalized = linkInput.trim();
                  if (!normalized) return;
                  if (
                    normalized.startsWith("http://") ||
                    normalized.startsWith("https://") ||
                    normalized.startsWith("data:image/")
                  ) {
                    setImageSource(normalized);
                    setStatusMessage("Using image URL.");
                  } else {
                    setStatusMessage("Enter a valid image URL.");
                  }
                }}
              >
                Use URL
              </button>
            </div>
          </div>

          <div className="rounded-xl border border-white/10 bg-[#112a1d] p-4">
            <p className="text-sm text-zinc-200">Preview</p>
            {imageSource ? (
              <img
                src={imageSource}
                alt="Preview"
                className="mt-3 max-h-56 w-full rounded-lg border border-white/10 object-contain"
              />
            ) : (
              <p className="mt-3 text-xs text-zinc-400">
                No image selected yet.
              </p>
            )}
            {statusMessage ? (
              <p className="mt-2 text-xs text-emerald-200">{statusMessage}</p>
            ) : null}
          </div>
        </div>

        <button
          type="button"
          disabled={
            !imageSource ||
            !selectedSlotId ||
            !selectedChain ||
            !selectedCa ||
            saveSceneSlot.isPending
          }
          className="mt-4 w-full rounded-lg bg-emerald-500/25 px-3 py-2 text-sm font-semibold text-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
          onClick={async () => {
            if (
              !imageSource ||
              !selectedSlotId ||
              !selectedChain ||
              !selectedCa
            )
              return;

            const decoration: DecorationConfig = {
              type: "image",
              name: "Community Image",
              imageUrl: imageSource,
              placedBy: walletAddress ?? "viewer",
              placedAt: new Date().toISOString(),
              jbmBurned: 0,
            };

            try {
              await saveSceneSlot.mutateAsync({
                chain: selectedChain,
                ca: selectedCa,
                slotId: selectedSlotId,
                decoration,
              });

              setStatusMessage("Placed on wall.");
              setBodegaOpen(false);
            } catch (error) {
              const message = error instanceof Error ? error.message : "Placement failed";
              setStatusMessage(`Placement failed: ${message}`);
            }
          }}
        >
          Place On Wall
        </button>
      </div>
    </aside>
  );
}
