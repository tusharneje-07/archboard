export type CompressedProjectPayload = {
  codec: "deflate";
  data: string;
  originalSize: number;
};

export type RemoteProject = {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  presentation?: boolean;
  nodeCount: number;
  compression: CompressedProjectPayload;
  workspaceId?: string | null;
};

export type ProjectLimitError = Error & { status: number; limit?: number; count?: number };

export async function authenticatedProjectRequest<T>(
  getAccessToken: () => Promise<string | null>,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const token = await getAccessToken();
  if (!token) throw Object.assign(new Error("Authentication is required."), { status: 401 });
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  if (init.body) headers.set("Content-Type", "application/json");
  const response = await fetch(path, { ...init, headers });
  const payload = await response.json().catch(() => ({ ok: false, error: "Project server returned invalid data." })) as {
    ok?: boolean;
    error?: string;
    limit?: number;
    count?: number;
  } & T;
  if (!response.ok) {
    const error = Object.assign(new Error(payload.error || `Project request failed (${response.status}).`), {
      status: response.status,
      limit: payload.limit,
      count: payload.count,
    }) as ProjectLimitError;
    throw error;
  }
  return payload;
}

export const listRemoteProjects = (getAccessToken: () => Promise<string | null>) =>
  authenticatedProjectRequest<{ ok: true; limit: number; count: number; projects: RemoteProject[] }>(getAccessToken, "/api/projects");

export const saveRemoteProject = (getAccessToken: () => Promise<string | null>, project: RemoteProject) =>
  authenticatedProjectRequest<{ ok: true; project: RemoteProject }>(getAccessToken, "/api/projects", {
    method: "POST",
    body: JSON.stringify(project),
  });

export const deleteRemoteProjects = (getAccessToken: () => Promise<string | null>, ids: string[]) =>
  authenticatedProjectRequest<{ ok: true; deleted: number }>(getAccessToken, "/api/projects", {
    method: "DELETE",
    body: JSON.stringify({ ids }),
  });
