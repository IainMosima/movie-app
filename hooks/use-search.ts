"use client";

import { useState, useCallback } from "react";
import useSWR from "swr";
import type { SearchResponse, SearchResult } from "@/types";

const fetcher = async (url: string): Promise<SearchResponse> => {
  const res = await fetch(url);
  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.error || "Search failed");
  }
  return res.json();
};

export function useSearch() {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [debounceTimer, setDebounceTimer] = useState<NodeJS.Timeout | null>(null);

  const { data, error, isLoading } = useSWR<SearchResponse>(
    debouncedQuery ? `/api/search?q=${encodeURIComponent(debouncedQuery)}` : null,
    fetcher,
    {
      revalidateOnFocus: false,
      dedupingInterval: 5000,
    }
  );

  const search = useCallback(
    (newQuery: string) => {
      setQuery(newQuery);

      // Clear existing timer
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }

      // Set new timer for debounced search
      const timer = setTimeout(() => {
        setDebouncedQuery(newQuery);
      }, 300);

      setDebounceTimer(timer);
    },
    [debounceTimer]
  );

  const clearSearch = useCallback(() => {
    setQuery("");
    setDebouncedQuery("");
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
  }, [debounceTimer]);

  // Group results by series for episodes
  const groupedResults = data?.results
    ? groupBySeries(data.results)
    : { movies: [], series: {} };

  return {
    query,
    search,
    clearSearch,
    results: data?.results || [],
    groupedResults,
    isLoading,
    error: error?.message || null,
  };
}

interface GroupedResults {
  movies: SearchResult[];
  series: Record<string, SeriesGroup>;
}

interface SeriesGroup {
  name: string;
  seasons: Record<number, SearchResult[]>;
}

function groupBySeries(results: SearchResult[]): GroupedResults {
  const movies: SearchResult[] = [];
  const series: Record<string, SeriesGroup> = {};

  for (const result of results) {
    if (result.type === "episode" && result.series) {
      if (!series[result.series]) {
        series[result.series] = {
          name: result.series,
          seasons: {},
        };
      }

      const season = result.season || 1;
      if (!series[result.series].seasons[season]) {
        series[result.series].seasons[season] = [];
      }

      series[result.series].seasons[season].push(result);

      // Sort episodes within season
      series[result.series].seasons[season].sort(
        (a, b) => (a.episode || 0) - (b.episode || 0)
      );
    } else {
      movies.push(result);
    }
  }

  return { movies, series };
}
