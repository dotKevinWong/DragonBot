"use client";

import { useEffect, useState } from "react";

interface Profile {
  name: string | null;
  pronouns: string | null;
  major: string | null;
  college: string | null;
  year: string | null;
  plan: string | null;
  description: string | null;
  coop1: string | null;
  coop2: string | null;
  coop3: string | null;
  clubs: string[] | null;
  isVerified: boolean;
  verifiedAt: string | null;
}

const YEAR_OPTIONS = ["Freshman", "Sophomore", "Pre-Junior", "Junior", "Senior", "Alumni"];

const PLAN_OPTIONS = ["5 Year/3 Co-Op", "4 Year/1 Co-Op", "4 Year/No Co-Op"];

const COLLEGE_OPTIONS = [
  "College of Arts and Sciences",
  "School of Biomedical Engineering, Science and Health Systems",
  "Bennett S. LeBow College of Business",
  "College of Computing & Informatics",
  "School of Economics",
  "School of Education",
  "College of Engineering",
  "Charles D. Close School of Entrepreneurship",
  "Pennoni Honors College",
  "Thomas R. Kline School of Law",
  "Antoinette Westphal College of Media Arts & Design",
  "College of Medicine",
  "College of Nursing and Health Professions",
  "Pennsylvania College of Optometry",
  "Goodwin College of Professional Studies",
  "Dornsife School of Public Health",
];

function Input({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="block text-xs font-semibold text-dc-text-secondary uppercase tracking-wide mb-1.5">
        {label}
      </label>
      <input
        className="w-full px-3 py-2 bg-dc-input border border-dc-border rounded-md text-dc-text-primary text-sm outline-none focus:border-dc-accent transition-colors"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </div>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
  placeholder?: string;
}) {
  return (
    <div>
      <label className="block text-xs font-semibold text-dc-text-secondary uppercase tracking-wide mb-1.5">
        {label}
      </label>
      <select
        className="w-full px-3 py-2 bg-dc-input border border-dc-border rounded-md text-dc-text-primary text-sm outline-none focus:border-dc-accent transition-colors cursor-pointer"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">{placeholder ?? "Select..."}</option>
        {options.map((opt) => (
          <option key={opt} value={opt}>{opt}</option>
        ))}
      </select>
    </div>
  );
}

export default function ProfilePage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    const jwt = localStorage.getItem("jwt");
    if (!jwt) {
      window.location.href = "/";
      return;
    }

    fetch("/api/profile", { headers: { Authorization: `Bearer ${jwt}` } })
      .then((res) => {
        if (res.status === 401) {
          localStorage.removeItem("jwt");
          window.location.href = "/";
          return null;
        }
        return res.json();
      })
      .then((data) => {
        if (data) setProfile(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  async function handleSave() {
    if (!profile) return;
    setSaving(true);
    setMessage(null);

    const jwt = localStorage.getItem("jwt");
    const res = await fetch("/api/profile", {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${jwt}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(profile),
    });

    if (res.ok) {
      setMessage({ type: "success", text: "Profile saved!" });
    } else {
      const data = await res.json();
      setMessage({ type: "error", text: data.error ?? "Failed to save." });
    }
    setSaving(false);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-6 h-6 border-2 border-dc-accent border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!profile) return <p className="text-dc-text-muted">Failed to load profile.</p>;

  function update(key: keyof Profile, value: string | null) {
    if (!profile) return;
    setProfile({ ...profile, [key]: value });
  }

  return (
    <div className="max-w-2xl">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold">Your Profile</h1>
          <div className="flex items-center gap-2 mt-1">
            <span
              className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full cursor-default relative group ${
                profile.isVerified
                  ? "bg-dc-success/20 text-dc-success"
                  : "bg-dc-danger/20 text-dc-danger"
              }`}
            >
              {profile.isVerified ? "✓ Verified" : "Not verified"}
              {profile.isVerified && profile.verifiedAt && (
                <span className="absolute left-0 top-full mt-1.5 px-2.5 py-1 bg-dc-bg-tertiary border border-dc-border text-dc-text-secondary text-[11px] rounded shadow-lg whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
                  Verified on {new Date(profile.verifiedAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
                </span>
              )}
            </span>
          </div>
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-4 py-2 bg-dc-accent hover:bg-dc-accent-hover disabled:opacity-50 text-white text-sm font-medium rounded-md transition-colors cursor-pointer disabled:cursor-not-allowed"
        >
          {saving ? "Saving..." : "Save Changes"}
        </button>
      </div>

      {message && (
        <div
          className={`px-4 py-3 rounded-md mb-6 text-sm ${
            message.type === "success"
              ? "bg-dc-success/10 border border-dc-success/30 text-dc-success"
              : "bg-dc-danger/10 border border-dc-danger/30 text-dc-danger"
          }`}
        >
          {message.text}
        </div>
      )}

      {/* Basic Info */}
      <div className="bg-dc-bg-secondary border border-dc-border rounded-lg p-5 mb-4">
        <h2 className="text-sm font-semibold text-dc-text-primary mb-4">Basic Information</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input label="Name" value={profile.name ?? ""} onChange={(v) => update("name", v || null)} />
          <Input label="Pronouns" value={profile.pronouns ?? ""} onChange={(v) => update("pronouns", v || null)} />
          <Input label="Major" value={profile.major ?? ""} onChange={(v) => update("major", v || null)} />
          <Select label="College" value={profile.college ?? ""} onChange={(v) => update("college", v || null)} options={COLLEGE_OPTIONS} placeholder="Select college..." />
          <Select label="Year" value={profile.year ?? ""} onChange={(v) => update("year", v || null)} options={YEAR_OPTIONS} placeholder="Select year..." />
          <Select label="Plan" value={profile.plan ?? ""} onChange={(v) => update("plan", v || null)} options={PLAN_OPTIONS} placeholder="Select plan..." />
        </div>
      </div>

      {/* Description */}
      <div className="bg-dc-bg-secondary border border-dc-border rounded-lg p-5 mb-4">
        <h2 className="text-sm font-semibold text-dc-text-primary mb-4">About You</h2>
        <label className="block text-xs font-semibold text-dc-text-secondary uppercase tracking-wide mb-1.5">
          Description
        </label>
        <textarea
          className="w-full px-3 py-2 bg-dc-input border border-dc-border rounded-md text-dc-text-primary text-sm outline-none focus:border-dc-accent transition-colors resize-y min-h-24"
          value={profile.description ?? ""}
          onChange={(e) => update("description", e.target.value || null)}
          placeholder="Tell us about yourself..."
        />
      </div>

      {/* Co-ops */}
      <div className="bg-dc-bg-secondary border border-dc-border rounded-lg p-5 mb-4">
        <h2 className="text-sm font-semibold text-dc-text-primary mb-4">Co-op Experience</h2>
        <div className="space-y-3">
          <Input label="Co-op 1" value={profile.coop1 ?? ""} onChange={(v) => update("coop1", v || null)} />
          <Input label="Co-op 2" value={profile.coop2 ?? ""} onChange={(v) => update("coop2", v || null)} />
          <Input label="Co-op 3" value={profile.coop3 ?? ""} onChange={(v) => update("coop3", v || null)} />
        </div>
      </div>

    </div>
  );
}
