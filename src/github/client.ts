import { Octokit } from "@octokit/rest";
import type { Release, ReleaseAsset } from "../types";

export class GitHubClient {
  private octokit: Octokit;

  constructor(token: string) {
    this.octokit = new Octokit({ auth: token, request: { timeout: 30000 } });
  }

  async getRelease(
    owner: string,
    repo: string,
    tag: string,
  ): Promise<Release | null> {
    try {
      const response = await this.octokit.repos.getReleaseByTag({
        owner,
        repo,
        tag,
      });

      return this.mapRelease(response.data);
    } catch {
      console.warn("GitHub release fetch failed");
      return null;
    }
  }

  async listReleases(
    owner: string,
    repo: string,
    limit: number = 30,
  ): Promise<Release[]> {
    try {
      const response = await this.octokit.repos.listReleases({
        owner,
        repo,
        per_page: limit,
      });

      return response.data.map((r) => this.mapRelease(r));
    } catch {
      console.warn("GitHub releases list failed");
      return [];
    }
  }

  async downloadAsset(
    owner: string,
    repo: string,
    assetId: number,
  ): Promise<Buffer | null> {
    try {
      const response = await this.octokit.repos.getReleaseAsset({
        owner,
        repo,
        asset_id: assetId,
        headers: {
          accept: "application/octet-stream",
        },
      });

      const data = response.data;

      if (data instanceof Buffer) {
        return data;
      }

      if (data instanceof ArrayBuffer) {
        return Buffer.from(data);
      }

      if (typeof data === "string") {
        return Buffer.from(data);
      }

      return null;
    } catch (error) {
      console.warn("GitHub asset download failed:", error);
      return null;
    }
  }

  private mapRelease(data: unknown): Release {
    const r = data as Record<string, unknown>;
    return {
      id: r.id as number,
      tag_name: r.tag_name as string,
      name: r.name as string,
      draft: r.draft as boolean,
      prerelease: r.prerelease as boolean,
      created_at: r.created_at as string,
      published_at: r.published_at as string,
      assets: ((r.assets as Array<Record<string, unknown>>) || []).map((a) => ({
        id: a.id as number,
        name: a.name as string,
        url: a.url as string,
        browser_download_url: a.browser_download_url as string,
        size: a.size as number,
        download_count: a.download_count as number,
        created_at: a.created_at as string,
        updated_at: a.updated_at as string,
      })),
    };
  }
}
