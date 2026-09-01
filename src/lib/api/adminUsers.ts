import { callServerApi } from "./client";
import { API_OPERATIONS } from "./endpoints";
import { mergeAdminAuthHeaders } from "./authHeaders";
import { unwrapServerFnArgs } from "./unwrap";

export type SetAdminUserPasswordPayload = {
  idToken: string;
  uid: string;
  password: string;
};

export type SetAdminUserPasswordResult = { ok: true } | { ok: false; error: string };

export async function adminSetUserPassword(
  input: SetAdminUserPasswordPayload | { data: SetAdminUserPasswordPayload },
): Promise<SetAdminUserPasswordResult> {
  const payload = unwrapServerFnArgs(input);
  const headers = await mergeAdminAuthHeaders();
  return callServerApi<SetAdminUserPasswordPayload, SetAdminUserPasswordResult>(
    API_OPERATIONS.adminSetUserPassword,
    { data: payload, headers },
  );
}

export const setAdminUserPassword = adminSetUserPassword;
