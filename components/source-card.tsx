"use client";

import { useState } from "react";
import { Star, Pencil, Trash2, Check, X, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { Source } from "@/types";

interface SourceCardProps {
  source: Source;
  isActive: boolean;
  onSetActive: () => void;
  onUpdate: (updates: Partial<Omit<Source, "id">>) => Promise<void>;
  onDelete: () => Promise<void>;
}

export function SourceCard({
  source,
  isActive,
  onSetActive,
  onUpdate,
  onDelete,
}: SourceCardProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(source.name);
  const [editUrl, setEditUrl] = useState(source.url);
  const [editQueryParam, setEditQueryParam] = useState(source.queryParam);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await onUpdate({
        name: editName,
        url: editUrl,
        queryParam: editQueryParam,
      });
      setIsEditing(false);
    } catch (err) {
      console.error("Failed to update source:", err);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      await onDelete();
    } catch (err) {
      console.error("Failed to delete source:", err);
      setIsDeleting(false);
    }
  };

  const handleCancel = () => {
    setEditName(source.name);
    setEditUrl(source.url);
    setEditQueryParam(source.queryParam);
    setIsEditing(false);
  };

  if (isEditing) {
    return (
      <Card className="p-4 bg-zinc-900/50 border-zinc-800">
        <div className="space-y-3">
          <div>
            <label className="text-xs text-zinc-500 mb-1 block">Name</label>
            <Input
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              placeholder="Source name"
              className="bg-zinc-800 border-zinc-700"
            />
          </div>
          <div>
            <label className="text-xs text-zinc-500 mb-1 block">URL</label>
            <Input
              value={editUrl}
              onChange={(e) => setEditUrl(e.target.value)}
              placeholder="https://api.example.com/search"
              className="bg-zinc-800 border-zinc-700"
            />
          </div>
          <div>
            <label className="text-xs text-zinc-500 mb-1 block">
              Query Parameter
            </label>
            <Input
              value={editQueryParam}
              onChange={(e) => setEditQueryParam(e.target.value)}
              placeholder="q"
              className="bg-zinc-800 border-zinc-700"
            />
          </div>
          <div className="flex gap-2 justify-end">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleCancel}
              disabled={isSaving}
            >
              <X className="h-4 w-4 mr-1" />
              Cancel
            </Button>
            <Button size="sm" onClick={handleSave} disabled={isSaving}>
              <Check className="h-4 w-4 mr-1" />
              Save
            </Button>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card
      className={cn(
        "p-4 bg-zinc-900/50 border-zinc-800 transition-colors",
        isActive && "border-emerald-600/50 bg-emerald-950/20"
      )}
    >
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="font-medium text-zinc-100 truncate">{source.name}</h3>
            {isActive && (
              <Badge variant="outline" className="text-emerald-400 border-emerald-600/50 text-xs">
                Active
              </Badge>
            )}
          </div>
          <p className="text-sm text-zinc-500 truncate flex items-center gap-1">
            <ExternalLink className="h-3 w-3 shrink-0" />
            {source.url}
          </p>
          <p className="text-xs text-zinc-600 mt-1">
            Query param: <code className="text-zinc-500">{source.queryParam}</code>
          </p>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {!isActive && (
            <Button
              variant="ghost"
              size="icon"
              onClick={onSetActive}
              className="h-8 w-8 text-zinc-500 hover:text-emerald-400"
              title="Set as active"
            >
              <Star className="h-4 w-4" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setIsEditing(true)}
            className="h-8 w-8 text-zinc-500 hover:text-zinc-300"
            title="Edit"
          >
            <Pencil className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleDelete}
            disabled={isDeleting}
            className="h-8 w-8 text-zinc-500 hover:text-red-400"
            title="Delete"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </Card>
  );
}
