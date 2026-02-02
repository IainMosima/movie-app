"use client";

import { useState, useEffect } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Loader2, RotateCcw, Save } from "lucide-react";
import { useSettings } from "@/hooks/use-settings";

export default function SettingsPage() {
  const { settings, isLoading, updateSettings, resetSettings } = useSettings();

  const [maxConnections, setMaxConnections] = useState(55);
  const [downloadLimit, setDownloadLimit] = useState(-1);
  const [uploadLimit, setUploadLimit] = useState(-1);
  const [cleanupDelay, setCleanupDelay] = useState(30);
  const [prebufferSeconds, setPrebufferSeconds] = useState(30);
  const [bufferSizeMB, setBufferSizeMB] = useState(100);
  const [isSaving, setIsSaving] = useState(false);
  const [isResetting, setIsResetting] = useState(false);

  // Load settings into form
  useEffect(() => {
    if (settings) {
      setMaxConnections(settings.maxConnections);
      setDownloadLimit(settings.downloadLimit);
      setUploadLimit(settings.uploadLimit);
      setCleanupDelay(settings.cleanupDelaySeconds);
      setPrebufferSeconds(settings.prebufferSeconds);
      setBufferSizeMB(settings.bufferSizeMB || 100);
    }
  }, [settings]);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await updateSettings({
        maxConnections,
        downloadLimit,
        uploadLimit,
        cleanupDelaySeconds: cleanupDelay,
        prebufferSeconds,
        bufferSizeMB,
      });
      toast.success("Settings saved");
    } catch (err) {
      toast.error("Failed to save settings");
    } finally {
      setIsSaving(false);
    }
  };

  const handleReset = async () => {
    setIsResetting(true);
    try {
      await resetSettings();
      toast.success("Settings reset to defaults");
    } catch (err) {
      toast.error("Failed to reset settings");
    } finally {
      setIsResetting(false);
    }
  };

  if (isLoading) {
    return (
      <main className="min-h-screen pt-14">
        <div className="max-w-2xl mx-auto px-4 py-8">
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-zinc-500" />
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen pt-14">
      <div className="max-w-2xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold">Settings</h1>
          <p className="text-zinc-500 text-sm mt-1">
            Configure the torrent engine and streaming behavior
          </p>
        </div>

        {/* Settings form */}
        <div className="space-y-6">
          {/* Connection settings */}
          <Card className="p-6 bg-zinc-900/50 border-zinc-800">
            <h2 className="font-semibold mb-4">Connection</h2>
            <div className="space-y-4">
              <div>
                <label className="text-sm text-zinc-400 mb-2 block">
                  Max Connections
                </label>
                <Input
                  type="number"
                  value={maxConnections}
                  onChange={(e) => setMaxConnections(Number(e.target.value))}
                  min={1}
                  max={200}
                  className="bg-zinc-800 border-zinc-700 w-32"
                />
                <p className="text-xs text-zinc-600 mt-1">
                  Maximum number of peer connections (1-200)
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm text-zinc-400 mb-2 block">
                    Download Limit (bytes/s)
                  </label>
                  <Input
                    type="number"
                    value={downloadLimit}
                    onChange={(e) => setDownloadLimit(Number(e.target.value))}
                    className="bg-zinc-800 border-zinc-700"
                  />
                  <p className="text-xs text-zinc-600 mt-1">
                    -1 for unlimited
                  </p>
                </div>

                <div>
                  <label className="text-sm text-zinc-400 mb-2 block">
                    Upload Limit (bytes/s)
                  </label>
                  <Input
                    type="number"
                    value={uploadLimit}
                    onChange={(e) => setUploadLimit(Number(e.target.value))}
                    className="bg-zinc-800 border-zinc-700"
                  />
                  <p className="text-xs text-zinc-600 mt-1">
                    -1 for unlimited
                  </p>
                </div>
              </div>
            </div>
          </Card>

          {/* Cleanup settings */}
          <Card className="p-6 bg-zinc-900/50 border-zinc-800">
            <h2 className="font-semibold mb-4">Auto-Cleanup</h2>
            <div className="space-y-4">
              <div>
                <label className="text-sm text-zinc-400 mb-2 block">
                  Cleanup Delay (seconds)
                </label>
                <Input
                  type="number"
                  value={cleanupDelay}
                  onChange={(e) => setCleanupDelay(Number(e.target.value))}
                  min={0}
                  max={3600}
                  className="bg-zinc-800 border-zinc-700 w-32"
                />
                <p className="text-xs text-zinc-600 mt-1">
                  How long to wait after the last viewer disconnects before
                  deleting torrent cache (0-3600 seconds)
                </p>
              </div>
            </div>
          </Card>

          {/* Buffering settings */}
          <Card className="p-6 bg-zinc-900/50 border-zinc-800">
            <h2 className="font-semibold mb-4">Playback & Buffering</h2>
            <div className="space-y-6">
              <div>
                <label className="text-sm text-zinc-400 mb-2 block">
                  Buffer Size (MB)
                </label>
                <Input
                  type="number"
                  value={bufferSizeMB}
                  onChange={(e) => setBufferSizeMB(Number(e.target.value))}
                  min={50}
                  max={500}
                  className="bg-zinc-800 border-zinc-700 w-32"
                />
                <p className="text-xs text-zinc-600 mt-1">
                  Amount of data to buffer ahead (50-500 MB). Higher values give more
                  viewing time before rebuffering. Recommended: 150-200 MB for 4K.
                </p>
              </div>

              <div>
                <label className="text-sm text-zinc-400 mb-2 block">
                  Prebuffer Duration (seconds)
                </label>
                <Input
                  type="number"
                  value={prebufferSeconds}
                  onChange={(e) => setPrebufferSeconds(Number(e.target.value))}
                  min={0}
                  max={120}
                  className="bg-zinc-800 border-zinc-700 w-32"
                />
                <p className="text-xs text-zinc-600 mt-1">
                  Seconds to wait before playback starts (0-120). Higher values
                  mean smoother playback but longer initial wait.
                </p>
              </div>
            </div>
          </Card>

          {/* Actions */}
          <div className="flex items-center justify-between pt-4">
            <Button
              variant="outline"
              onClick={handleReset}
              disabled={isResetting || isSaving}
              className="border-zinc-700"
            >
              {isResetting ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <RotateCcw className="h-4 w-4 mr-2" />
              )}
              Reset to Defaults
            </Button>

            <Button onClick={handleSave} disabled={isSaving || isResetting}>
              {isSaving ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Save className="h-4 w-4 mr-2" />
              )}
              Save Settings
            </Button>
          </div>
        </div>

        {/* Info */}
        <div className="mt-8 p-4 bg-zinc-900/30 rounded-xl border border-zinc-800">
          <h3 className="font-medium text-zinc-300 mb-2">
            LAN Access
          </h3>
          <p className="text-sm text-zinc-500">
            To access Spaceflix from other devices on your network, run the app
            and open{" "}
            <code className="text-zinc-400 bg-black/30 px-1 rounded">
              http://YOUR_IP:3000
            </code>{" "}
            from your TV, phone, or tablet. Find your IP with{" "}
            <code className="text-zinc-400 bg-black/30 px-1 rounded">
              ifconfig | grep inet
            </code>
          </p>
        </div>
      </div>
    </main>
  );
}
