import { requireActiveAdminFromToken } from "../../../src/server/admin/requireActiveAdmin";
import { requireSuperAdminFromToken } from "../../../src/server/admin/requireSuperAdmin";

export async function verifyActiveAdmin(idToken: string): Promise<string> {
  return requireActiveAdminFromToken(idToken);
}

export async function verifySuperAdmin(idToken: string): Promise<string> {
  return requireSuperAdminFromToken(idToken);
}
