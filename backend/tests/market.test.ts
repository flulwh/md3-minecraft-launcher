import { describe, it, expect, beforeEach } from "vitest";
import { MarketService } from "../src/core/market/market-service.js";
import type { HttpClient } from "../src/infrastructure/http/http-client.js";
import { makeConfig, makeLogger } from "./helpers.js";

interface FakeHttpState {
  searchCalls: number;
}

function fakeHttp(state: FakeHttpState) {
  const http = {
    getJson: async (url: string) => {
      if (url.includes("/search")) {
        state.searchCalls += 1;
        const downloads = url.includes("index=downloads") ? 500 : 100;
        return {
          hits: [
            {
              project_id: "AABBCC",
              slug: "sodium",
              title: "Sodium",
              description: "Fast rendering",
              project_type: "mod",
              downloads,
              icon_url: "https://x/icon.png",
              author: "jellysquid",
            },
          ],
        };
      }
      if (url.includes("/project/sodium/version")) {
        return [
          {
            id: "v1",
            project_id: "AABBCC",
            name: "0.5.11",
            version_number: "0.5.11",
            game_versions: ["1.21", "1.21.1"],
            loaders: ["fabric"],
            date_published: "2024-06-01T00:00:00.000Z",
            files: [
              {
                url: "https://cdn/mod.jar",
                filename: "sodium-0.5.11.jar",
                primary: true,
                size: 123456,
                hashes: { sha1: "aaaa", sha512: "bbbb" },
              },
              {
                url: "https://cdn/alt.jar",
                filename: "sodium-alt.jar",
                size: 10,
              },
            ],
            dependencies: [{ project_id: "fabric-api", version_id: "dep1", dependency_type: "required" }],
          },
        ];
      }
      if (url.includes("/project/sodium")) {
        return {
          id: "AABBCC",
          slug: "sodium",
          title: "Sodium",
          description: "Fast rendering",
          project_type: "mod",
          downloads: 999,
          icon_url: "https://x/icon.png",
          project_link: "https://modrinth.com/mod/sodium",
          author: "jellysquid",
        };
      }
      throw new Error(`no stub for ${url}`);
    },
  } as unknown as HttpClient;
  return http;
}

let state: FakeHttpState;
let service: MarketService;

beforeEach(() => {
  state = { searchCalls: 0 };
  service = new MarketService(fakeHttp(state), makeConfig(), makeLogger());
});

describe("MarketService · Modrinth provider", () => {
  it("maps search hits to summaries", async () => {
    const items = await service.search("modrinth", { query: "sodium", type: "mod" });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: "AABBCC",
      name: "Sodium",
      type: "mod",
      slug: "sodium",
      author: "jellysquid",
      iconUrl: "https://x/icon.png",
      downloads: 100,
    });
  });

  it("maps a version, picking the primary file and preferring sha512", async () => {
    const versions = await service.versions("modrinth", "sodium");
    expect(versions).toHaveLength(1);
    const v = versions[0]!;
    expect(v.versionName).toBe("0.5.11");
    expect(v.minecraftVersions).toEqual(["1.21", "1.21.1"]);
    expect(v.loader).toBe("fabric");
    expect(v.fileName).toBe("sodium-0.5.11.jar");
    expect(v.fileSize).toBe(123456);
    expect(v.hash).toEqual({ algorithm: "sha512", value: "bbbb" });
    expect(v.dependencies[0]).toMatchObject({ dependencyId: "fabric-api", versionId: "dep1" });
  });

  it("returns project detail", async () => {
    const item = await service.project("modrinth", "sodium");
    expect(item.website).toBe("https://modrinth.com/mod/sodium");
    expect(item.downloads).toBe(999);
  });

  it("caches repeated searches to avoid upstream rate limits", async () => {
    await service.search("modrinth", { query: "sodium", type: "mod" });
    await service.search("modrinth", { query: "sodium", type: "mod" });
    expect(state.searchCalls).toBe(1); // second call served from memory cache
  });

  it("provides a home feed of 3 lists", async () => {
    const home = await service.home("modrinth");
    expect(home.featured).toHaveLength(1);
    expect(home.popular).toHaveLength(1);
    expect(home.updated).toHaveLength(1);
    // popular feed requested the downloads index
    expect(state.searchCalls).toBe(3);
  });
});