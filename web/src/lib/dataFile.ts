/** Thrown when a bundled data file did not arrive as data (e.g. the host served the HTML app). */
export class DataFileError extends Error {}

const PARQUET_MAGIC = "PAR1";

/** True only for bytes that start with the Parquet magic number. HTML is never data. */
export function isParquetBytes(bytes: Uint8Array): boolean {
  if (bytes.length < 4) return false;
  return String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) === PARQUET_MAGIC;
}

/** Downloads a Parquet file and refuses anything that is not Parquet. */
export async function fetchParquet(url: string, fetcher: typeof fetch = fetch): Promise<Uint8Array> {
  let resp: Response;
  try {
    resp = await fetcher(url);
  } catch (err) {
    throw new DataFileError(`${url}: ${String(err)}`);
  }
  if (!resp.ok) throw new DataFileError(`${url}: HTTP ${resp.status}`);
  const bytes = new Uint8Array(await resp.arrayBuffer());
  if (!isParquetBytes(bytes)) throw new DataFileError(`${url}: not a Parquet file (${resp.headers.get("content-type") ?? "?"})`);
  return bytes;
}
