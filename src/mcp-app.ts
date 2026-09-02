/**
 * ParkkiS MCP App Tool Handler
 * Standard: @modelcontextprotocol/ext-apps (2026 UI Capabilities Standard)
 * Reference: https://modelcontextprotocol.info/blog/mcp-apps-ui-capabilities/
 *
 * Exposes interactive parking maplet tools with `_meta.ui.resourceUri`.
 */

import { calculateParkingRiskContract } from "./contracts";
import type { ParkingRiskContract } from "../../contracts";

export interface McpToolResponse {
  content: Array<{
    type: "text" | "resource";
    text?: string;
    resource?: {
      uri: string;
      mimeType: string;
      text?: string;
    };
  }>;
  _meta?: {
    ui?: {
      resourceUri: string;
    };
  };
}

/**
 * MCP App Tool: get_parking_maplet
 * Returns structured parking risk contract data and an interactive UI widget resource URI.
 */
export async function getParkingMapletTool(args: {
  venueSlug: string;
  venueName: string;
  lat: number;
  lng: number;
}): Promise<McpToolResponse> {
  const risk: ParkingRiskContract = calculateParkingRiskContract(
    args.venueSlug || "default",
    args.venueName || "Kenttä",
    { lat: args.lat, lng: args.lng }
  );

  const summary = `🅿️ Pysäköintiturvallisuus (${risk.venueName}): Riski-indeksi ${risk.riskRating1to10}/10 (${risk.safetyCategory.toUpperCase()}). Kävelyetäisyys: ${risk.walkDistanceMeters}m (~${risk.walkTimeMinutes} min). Aluetunnus: ${risk.zoneLabel}.`;

  return {
    content: [
      {
        type: "text",
        text: summary,
      },
    ],
    _meta: {
      ui: {
        resourceUri: `ui://parkkis/maplet?venue=${encodeURIComponent(risk.venueName)}&lat=${args.lat}&lng=${args.lng}&risk=${risk.riskRating1to10}`,
      },
    },
  };
}
