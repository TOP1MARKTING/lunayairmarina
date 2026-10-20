import { useEffect, useState, type ReactNode } from "react";
import { motion } from "motion/react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { AdminSidebar } from "./AdminSidebar";
import { AdminHeader } from "./AdminHeader";
import { useAdminAuth } from "@/hooks/useAdminAuth";
import { PERMISSION_ROUTE, type AdminPermission } from "@/lib/admin-roles";

interface AdminLayoutProps {
  title: string;
  children: ReactNode;
}

function permissionForPath(pathname: string): AdminPermission | null {
  const entry = Object.entries(PERMISSION_ROUTE).find(([, path]) => path === pathname);
  return (entry?.[0] as AdminPermission | undefined) ?? null;
}

export function AdminLayout({ title, children }: AdminLayoutProps) {
  const [open, setOpen] = useState(false);
  const { authed, can } = useAdminAuth();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (state) => state.location.pathname });

  useEffect(() => {
    if (authed === false) navigate({ to: "/admin/login" });
  }, [authed, navigate]);

  useEffect(() => {
    if (authed !== true) return;
    const permission = permissionForPath(pathname);
    if (permission && !can(permission) && pathname !== "/admin/dashboard") {
      navigate({ to: "/admin/dashboard" });
    }
  }, [authed, can, navigate, pathname]);

  // Close the mobile drawer on navigation.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    document.documentElement.classList.add("admin-hide-scrollbar");
    document.body.classList.add("admin-hide-scrollbar");
    return () => {
      document.documentElement.classList.remove("admin-hide-scrollbar");
      document.body.classList.remove("admin-hide-scrollbar");
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  return (
    <div className="admin-shell admin-hide-scrollbar min-h-dvh overflow-x-clip">
      <AdminSidebar open={open} onClose={() => setOpen(false)} />
      <div className="min-w-0 lg:ps-72">
        <AdminHeader title={title} onMenu={() => setOpen(true)} />
        <motion.main
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          className="admin-hide-scrollbar mx-auto w-full max-w-[1600px] px-3 py-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:px-5 sm:py-8 lg:px-8"
        >
          {children}
        </motion.main>
      </div>
    </div>
  );
}
