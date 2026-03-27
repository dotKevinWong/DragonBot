"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

export default function OAuthPage() {
  return (
    <Suspense fallback={
      <main className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-dc-accent border-t-transparent rounded-full animate-spin" />
      </main>
    }>
      <OAuthContent />
    </Suspense>
  );
}

function OAuthContent() {
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = searchParams.get("token");
    if (!token) {
      setStatus("error");
      setError("No token provided.");
      return;
    }

    fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    })
      .then(async (res) => {
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error ?? "Authentication failed");
        }
        return res.json();
      })
      .then((data: { jwt: string }) => {
        localStorage.setItem("jwt", data.jwt);
        setStatus("success");
        window.location.href = "/dashboard/profile";
      })
      .catch((err: Error) => {
        setStatus("error");
        setError(err.message);
      });
  }, [searchParams]);

  return (
    <main className="min-h-screen flex items-center justify-center">
      <div className="max-w-sm w-full text-center px-6">
        {status === "loading" && (
          <div className="flex flex-col items-center gap-4">
            <div className="w-8 h-8 border-2 border-dc-accent border-t-transparent rounded-full animate-spin" />
            <p className="text-dc-text-secondary">Authenticating...</p>
          </div>
        )}
        {status === "success" && (
          <div className="flex flex-col items-center gap-4">
            <div className="w-12 h-12 rounded-full bg-dc-success/20 flex items-center justify-center">
              <span className="text-dc-success text-xl">✓</span>
            </div>
            <p className="text-dc-text-secondary">Redirecting to dashboard...</p>
          </div>
        )}
        {status === "error" && (
          <div className="bg-dc-bg-secondary border border-dc-border rounded-lg p-8">
            <div className="w-12 h-12 rounded-full bg-dc-danger/20 flex items-center justify-center mx-auto mb-4">
              <span className="text-dc-danger text-xl">✕</span>
            </div>
            <h2 className="text-xl font-semibold mb-2">Authentication Failed</h2>
            <p className="text-dc-danger mb-4">{error}</p>
            <p className="text-dc-text-muted text-sm">
              Please use <code className="bg-dc-bg-tertiary px-1.5 py-0.5 rounded text-dc-accent text-xs">/login</code> in Discord to get a new link.
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
