"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { DashboardSidebar } from "@/components/dashboard/DashboardSidebar";
import { billingMeRequest, listInstances, type MeUser } from "@/lib/api";
import { getToken } from "@/lib/token";

type Props = {
  user: MeUser;
  onLogout?: () => void;
  title: string;
  headerRight?: React.ReactNode;
  children: React.ReactNode;
};

export function InstancesShell({ user, onLogout, title, headerRight, children }: Props) {
  const token = getToken() ?? "";
  const pathname = usePathname();
  const [instanceCount, setInstanceCount] = useState(0);
  const [planLabel, setPlanLabel] = useState("Free plan");

  useEffect(() => {
    if (!token) return;
    listInstances(token)
      .then((list) => setInstanceCount(list.length))
      .catch(() => setInstanceCount(0));
  }, [token, pathname]);

  useEffect(() => {
    if (!token) return;
    billingMeRequest(token)
      .then((b) => setPlanLabel(b.plan ? `${b.plan.name} plan` : "Free plan"))
      .catch(() => setPlanLabel("Free plan"));
  }, [token]);

  return (
    <div className="min-h-screen bg-bg3 pl-[220px]">
      <DashboardSidebar
        userEmail={user.email}
        planLabel={planLabel}
        instanceCount={instanceCount}
        isSuperadmin={user.role === "superadmin"}
        onLogout={onLogout}
      />
      <div className="flex min-h-screen flex-col">
        <header className="sticky top-0 z-10 flex h-[52px] items-center justify-between border-b border-border bg-bg px-7">
          <span className="text-[15px] font-medium text-ink">{title}</span>
          {headerRight ? <div className="flex items-center gap-2">{headerRight}</div> : null}
        </header>
        {children}
      </div>
    </div>
  );
}
