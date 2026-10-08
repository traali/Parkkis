/**
 * ParkkiS MCP App Tool Handler
 *
 * Returns a deep link to the live ParkkiS map for a venue. It does not invent a
 * risk score: the score is shown on the map, computed from real fine data.
 */

import { buildParkingDeepLink } from "./contracts";

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

/** MCP App Tool: get_parking_maplet */
export async function getParkingMapletTool(args: {
  venueSlug: string;
  venueName: string;
  lat: number;
  lng: number;
}): Promise<McpToolResponse> {
  const name = args.venueName || args.venueSlug || "Kohde";
  const url = buildParkingDeepLink(name, { lat: args.lat, lng: args.lng }, { embed: true });
  return {
    content: [
      {
        type: "text",
        text: `🅿️ ${name}: pysäköintipaikat, kyltit ja sakkotilastot kartalla: ${url}`,
      },
    ],
    _meta: {
      ui: {
        resourceUri: url,
      },
    },
  };
}
