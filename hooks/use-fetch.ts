"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { toast } from "sonner";

// ─── Types ────────────────────────────────────────────────────────────────────

export type FetchError = {
  message: string;
  status?: number;
  details?: unknown;
};

type MutationOptions<TData, TBody> = {
  /** Toast shown on success. Pass false to suppress. */
  successMessage?: string | ((data: TData) => string) | false;
  /** Toast shown on error. Pass false to suppress. */
  errorMessage?: string | false;
  /** Called after a successful response. */
  onSuccess?: (data: TData, body: TBody) => void;
  /** Called after a failed response. */
  onError?: (error: FetchError, body: TBody) => void;
};

type MutationResult<TData, TBody> = {
  execute: (body: TBody) => Promise<TData | null>;
  loading: boolean;
  error: FetchError | null;
  data: TData | null;
  reset: () => void;
};

type QueryOptions<TData> = {
  /** Run immediately on mount (default: true) */
  immediate?: boolean;
  /** Toast shown on error. Pass false to suppress. */
  errorMessage?: string | false;
  /** Called after a successful response. */
  onSuccess?: (data: TData) => void;
  /** Called after a failed response. */
  onError?: (error: FetchError) => void;
};

type QueryResult<TData> = {
  refetch: () => Promise<void>;
  loading: boolean;
  error: FetchError | null;
  data: TData | null;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function parseResponse<TData>(res: Response): Promise<TData> {
  const contentType = res.headers.get("content-type") ?? "";
  const body = contentType.includes("application/json")
    ? await res.json()
    : await res.text();

  if (!res.ok) {
    const message =
      (typeof body === "object" && body !== null && "message" in body
        ? String((body as { message: unknown }).message)
        : null) ??
      (typeof body === "string" && body.length ? body : null) ??
      `Request failed (${res.status})`;

    throw { message, status: res.status, details: body } satisfies FetchError;
  }

  return body as TData;
}

function buildMutationFetcher(method: string) {
  return async function fetcher<TData, TBody>(
    url: string,
    body: TBody
  ): Promise<TData> {
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return parseResponse<TData>(res);
  };
}

const postFetcher = buildMutationFetcher("POST");
const putFetcher = buildMutationFetcher("PUT");
const patchFetcher = buildMutationFetcher("PATCH");

async function deleteFetcher<TData>(url: string): Promise<TData> {
  const res = await fetch(url, { method: "DELETE" });
  return parseResponse<TData>(res);
}

// ─── Core mutation hook ───────────────────────────────────────────────────────

function useMutation<TData, TBody>(
  url: string,
  method: (url: string, body: TBody) => Promise<TData>,
  options: MutationOptions<TData, TBody> = {}
): MutationResult<TData, TBody> {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<FetchError | null>(null);
  const [data, setData] = useState<TData | null>(null);

  // Keep options stable so callers don't need to memoize
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const execute = useCallback(
    async (body: TBody): Promise<TData | null> => {
      setLoading(true);
      setError(null);

      try {
        const result = await method(url, body);
        setData(result);

        const { successMessage, onSuccess } = optionsRef.current;
        if (successMessage !== false) {
          const msg =
            typeof successMessage === "function"
              ? successMessage(result)
              : (successMessage ?? "Success");
          toast.success(msg);
        }

        onSuccess?.(result, body);
        return result;
      } catch (err) {
        const fetchError = err as FetchError;
        setError(fetchError);

        const { errorMessage, onError } = optionsRef.current;
        if (errorMessage !== false) {
          toast.error(errorMessage ?? fetchError.message ?? "Something went wrong");
        }

        onError?.(fetchError, body);
        return null;
      } finally {
        setLoading(false);
      }
    },
    // url and method are stable references
    [url, method]
  );

  const reset = useCallback(() => {
    setData(null);
    setError(null);
    setLoading(false);
  }, []);

  return { execute, loading, error, data, reset };
}

// ─── Public mutation hooks ────────────────────────────────────────────────────

export function usePostCallback<TData = unknown, TBody = unknown>(
  url: string,
  options: MutationOptions<TData, TBody> = {}
): MutationResult<TData, TBody> {
  return useMutation<TData, TBody>(url, postFetcher, options);
}

export function usePutCallback<TData = unknown, TBody = unknown>(
  url: string,
  options: MutationOptions<TData, TBody> = {}
): MutationResult<TData, TBody> {
  return useMutation<TData, TBody>(url, putFetcher, options);
}

export function usePatchCallback<TData = unknown, TBody = unknown>(
  url: string,
  options: MutationOptions<TData, TBody> = {}
): MutationResult<TData, TBody> {
  return useMutation<TData, TBody>(url, patchFetcher, options);
}

// DELETE has no request body — just a URL
export function useDeleteCallback<TData = unknown>(
  url: string,
  options: MutationOptions<TData, void> = {}
): Omit<MutationResult<TData, void>, "execute"> & { execute: () => Promise<TData | null> } {
  const inner = useMutation<TData, void>(
    url,
    (u) => deleteFetcher<TData>(u),
    options
  );
  const execute = useCallback(() => inner.execute(undefined as void), [inner.execute]);
  return { ...inner, execute };
}

// ─── GET query hook ───────────────────────────────────────────────────────────

export function useFetch<TData = unknown>(
  url: string,
  options: QueryOptions<TData> = {}
): QueryResult<TData> {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<FetchError | null>(null);
  const [data, setData] = useState<TData | null>(null);

  const optionsRef = useRef(options);
  optionsRef.current = options;

  const { immediate = true } = options;

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(url);
      const result = await parseResponse<TData>(res);
      setData(result);
      optionsRef.current.onSuccess?.(result);
    } catch (err) {
      const fetchError = err as FetchError;
      setError(fetchError);

      const { errorMessage } = optionsRef.current;
      if (errorMessage !== false) {
        toast.error(errorMessage ?? fetchError.message ?? "Failed to load data");
      }

      optionsRef.current.onError?.(fetchError);
    } finally {
      setLoading(false);
    }
  }, [url]);

  useEffect(() => {
    if (immediate) refetch();
  }, [immediate, refetch]);

  return { refetch, loading, error, data };
}
