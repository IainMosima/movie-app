"use client";

import { useState } from "react";
import { Plus, Loader2, CheckCircle2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { Source } from "@/types";

interface AddSourceDialogProps {
  onAdd: (source: Omit<Source, "id">) => Promise<void>;
}

export function AddSourceDialog({ onAdd }: AddSourceDialogProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [queryParam, setQueryParam] = useState("q");
  const [isAdding, setIsAdding] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<"success" | "error" | null>(null);

  const handleAdd = async () => {
    if (!name.trim() || !url.trim()) return;

    setIsAdding(true);
    try {
      await onAdd({
        name: name.trim(),
        url: url.trim(),
        queryParam: queryParam.trim() || "q",
      });
      // Reset form
      setName("");
      setUrl("");
      setQueryParam("q");
      setTestResult(null);
      setOpen(false);
    } catch (err) {
      console.error("Failed to add source:", err);
    } finally {
      setIsAdding(false);
    }
  };

  const handleTest = async () => {
    if (!url.trim()) return;

    setIsTesting(true);
    setTestResult(null);

    try {
      const testUrl = new URL(url);
      testUrl.searchParams.set(queryParam || "q", "test");

      const response = await fetch(testUrl.toString(), {
        method: "GET",
        headers: { Accept: "application/json" },
      });

      if (response.ok) {
        const data = await response.json();
        if (data.results && Array.isArray(data.results)) {
          setTestResult("success");
        } else {
          setTestResult("error");
        }
      } else {
        setTestResult("error");
      }
    } catch (err) {
      setTestResult("error");
    } finally {
      setIsTesting(false);
    }
  };

  const isValid = name.trim() && url.trim();

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="gap-2">
          <Plus className="h-4 w-4" />
          Add Source
        </Button>
      </DialogTrigger>
      <DialogContent className="bg-zinc-900 border-zinc-800">
        <DialogHeader>
          <DialogTitle>Add New Source</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div>
            <label className="text-sm text-zinc-400 mb-2 block">Name</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Torrent Source"
              className="bg-zinc-800 border-zinc-700"
            />
          </div>

          <div>
            <label className="text-sm text-zinc-400 mb-2 block">API URL</label>
            <Input
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                setTestResult(null);
              }}
              placeholder="https://api.example.com/search"
              className="bg-zinc-800 border-zinc-700"
            />
            <p className="text-xs text-zinc-600 mt-1">
              The endpoint that accepts search queries
            </p>
          </div>

          <div>
            <label className="text-sm text-zinc-400 mb-2 block">
              Query Parameter
            </label>
            <Input
              value={queryParam}
              onChange={(e) => {
                setQueryParam(e.target.value);
                setTestResult(null);
              }}
              placeholder="q"
              className="bg-zinc-800 border-zinc-700"
            />
            <p className="text-xs text-zinc-600 mt-1">
              The URL parameter name for search queries (e.g., "q" for ?q=searchterm)
            </p>
          </div>

          {/* Test result */}
          {testResult && (
            <div
              className={`flex items-center gap-2 p-3 rounded-lg ${
                testResult === "success"
                  ? "bg-emerald-950/50 text-emerald-400"
                  : "bg-red-950/50 text-red-400"
              }`}
            >
              {testResult === "success" ? (
                <>
                  <CheckCircle2 className="h-4 w-4" />
                  <span className="text-sm">Connection successful!</span>
                </>
              ) : (
                <>
                  <XCircle className="h-4 w-4" />
                  <span className="text-sm">
                    Connection failed. Check the URL and try again.
                  </span>
                </>
              )}
            </div>
          )}
        </div>

        <div className="flex justify-between">
          <Button
            variant="outline"
            onClick={handleTest}
            disabled={!url.trim() || isTesting}
            className="border-zinc-700"
          >
            {isTesting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Testing...
              </>
            ) : (
              "Test Connection"
            )}
          </Button>

          <Button onClick={handleAdd} disabled={!isValid || isAdding}>
            {isAdding ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Adding...
              </>
            ) : (
              "Add Source"
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
