import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSettings, updateSettings, resetSettings } from "@/lib/settings-store";

const UpdateSettingsSchema = z.object({
  downloadLimit: z.number().optional(),
  uploadLimit: z.number().optional(),
  maxConnections: z.number().min(1).max(200).optional(),
  cleanupDelaySeconds: z.number().min(0).max(3600).optional(),
  prebufferSeconds: z.number().min(0).max(120).optional(),
});

// GET /api/settings - Get engine settings
export async function GET() {
  try {
    const settings = getSettings();
    return NextResponse.json(settings);
  } catch (error) {
    console.error("Failed to get settings:", error);
    return NextResponse.json(
      { error: "Failed to get settings" },
      { status: 500 }
    );
  }
}

// PUT /api/settings - Update engine settings
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const validated = UpdateSettingsSchema.parse(body);

    const settings = updateSettings(validated);
    return NextResponse.json(settings);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid request", details: error.issues },
        { status: 400 }
      );
    }
    console.error("Failed to update settings:", error);
    return NextResponse.json(
      { error: "Failed to update settings" },
      { status: 500 }
    );
  }
}

// DELETE /api/settings - Reset to defaults
export async function DELETE() {
  try {
    const settings = resetSettings();
    return NextResponse.json(settings);
  } catch (error) {
    console.error("Failed to reset settings:", error);
    return NextResponse.json(
      { error: "Failed to reset settings" },
      { status: 500 }
    );
  }
}
