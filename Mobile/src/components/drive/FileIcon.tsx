import React from "react";

interface FileIconProps {
  fileName?: string;
  category?: string;
  className?: string;
}

interface FileBoxProps {
  gradId: string;
  colors: [string, string];
  children: React.ReactNode;
  className?: string;
}

interface ExtensionConfig {
  gradient: [string, string];
  iconType: "doc" | "image" | "video" | "audio" | "archive" | "code" | "data" | "executable" | "apk" | "disc";
  label: string;
}

const EXT_MAP: Record<string, ExtensionConfig> = {
  // Documents
  pdf: { gradient: ["#EF4444", "#991B1B"], iconType: "doc", label: "PDF" },
  doc: { gradient: ["#3B82F6", "#1D4ED8"], iconType: "doc", label: "DOC" },
  docx: { gradient: ["#3B82F6", "#1D4ED8"], iconType: "doc", label: "DOCX" },
  pages: { gradient: ["#3B82F6", "#1D4ED8"], iconType: "doc", label: "PAGES" },
  xls: { gradient: ["#10B981", "#064E3B"], iconType: "doc", label: "XLS" },
  xlsx: { gradient: ["#10B981", "#064E3B"], iconType: "doc", label: "XLSX" },
  numbers: { gradient: ["#10B981", "#064E3B"], iconType: "doc", label: "NUM" },
  csv: { gradient: ["#059669", "#064E3B"], iconType: "data", label: "CSV" },
  ppt: { gradient: ["#F59E0B", "#B45309"], iconType: "doc", label: "PPT" },
  pptx: { gradient: ["#F59E0B", "#B45309"], iconType: "doc", label: "PPTX" },
  key: { gradient: ["#F59E0B", "#B45309"], iconType: "doc", label: "KEY" },
  keynote: { gradient: ["#F59E0B", "#B45309"], iconType: "doc", label: "KEY" },
  txt: { gradient: ["#6B7280", "#374151"], iconType: "doc", label: "TXT" },
  rtf: { gradient: ["#6B7280", "#374151"], iconType: "doc", label: "RTF" },
  md: { gradient: ["#4B5563", "#1F2937"], iconType: "doc", label: "MD" },
  epub: { gradient: ["#8B5CF6", "#5B21B6"], iconType: "doc", label: "EPUB" },
  mobi: { gradient: ["#8B5CF6", "#5B21B6"], iconType: "doc", label: "MOBI" },

  // Images
  png: { gradient: ["#10B981", "#047857"], iconType: "image", label: "PNG" },
  jpg: { gradient: ["#10B981", "#047857"], iconType: "image", label: "JPG" },
  jpeg: { gradient: ["#10B981", "#047857"], iconType: "image", label: "JPEG" },
  gif: { gradient: ["#10B981", "#047857"], iconType: "image", label: "GIF" },
  webp: { gradient: ["#10B981", "#047857"], iconType: "image", label: "WEBP" },
  svg: { gradient: ["#10B981", "#047857"], iconType: "image", label: "SVG" },
  bmp: { gradient: ["#10B981", "#047857"], iconType: "image", label: "BMP" },
  avif: { gradient: ["#10B981", "#047857"], iconType: "image", label: "AVIF" },
  heic: { gradient: ["#10B981", "#047857"], iconType: "image", label: "HEIC" },
  tiff: { gradient: ["#10B981", "#047857"], iconType: "image", label: "TIFF" },
  psd: { gradient: ["#3B82F6", "#1E3A8A"], iconType: "image", label: "PSD" },
  ai: { gradient: ["#F59E0B", "#78350F"], iconType: "image", label: "AI" },

  // Video
  mp4: { gradient: ["#8B5CF6", "#4C1D95"], iconType: "video", label: "MP4" },
  mkv: { gradient: ["#8B5CF6", "#4C1D95"], iconType: "video", label: "MKV" },
  avi: { gradient: ["#8B5CF6", "#4C1D95"], iconType: "video", label: "AVI" },
  mov: { gradient: ["#8B5CF6", "#4C1D95"], iconType: "video", label: "MOV" },
  webm: { gradient: ["#8B5CF6", "#4C1D95"], iconType: "video", label: "WEBM" },
  flv: { gradient: ["#8B5CF6", "#4C1D95"], iconType: "video", label: "FLV" },
  "3gp": { gradient: ["#8B5CF6", "#4C1D95"], iconType: "video", label: "3GP" },
  wmv: { gradient: ["#8B5CF6", "#4C1D95"], iconType: "video", label: "WMV" },

  // Audio
  mp3: { gradient: ["#06B6D4", "#0891B2"], iconType: "audio", label: "MP3" },
  wav: { gradient: ["#06B6D4", "#0891B2"], iconType: "audio", label: "WAV" },
  flac: { gradient: ["#06B6D4", "#0891B2"], iconType: "audio", label: "FLAC" },
  ogg: { gradient: ["#06B6D4", "#0891B2"], iconType: "audio", label: "OGG" },
  aac: { gradient: ["#06B6D4", "#0891B2"], iconType: "audio", label: "AAC" },
  m4a: { gradient: ["#06B6D4", "#0891B2"], iconType: "audio", label: "M4A" },
  opus: { gradient: ["#06B6D4", "#0891B2"], iconType: "audio", label: "OPUS" },
  wma: { gradient: ["#06B6D4", "#0891B2"], iconType: "audio", label: "WMA" },

  // Archives
  zip: { gradient: ["#F97316", "#C2410C"], iconType: "archive", label: "ZIP" },
  rar: { gradient: ["#F97316", "#C2410C"], iconType: "archive", label: "RAR" },
  "7z": { gradient: ["#F97316", "#C2410C"], iconType: "archive", label: "7Z" },
  tar: { gradient: ["#F97316", "#C2410C"], iconType: "archive", label: "TAR" },
  gz: { gradient: ["#F97316", "#C2410C"], iconType: "archive", label: "GZ" },
  tgz: { gradient: ["#F97316", "#C2410C"], iconType: "archive", label: "TGZ" },

  // Code
  js: { gradient: ["#F59E0B", "#D97706"], iconType: "code", label: "JS" },
  mjs: { gradient: ["#F59E0B", "#D97706"], iconType: "code", label: "MJS" },
  ts: { gradient: ["#2563EB", "#1D4ED8"], iconType: "code", label: "TS" },
  tsx: { gradient: ["#2563EB", "#1D4ED8"], iconType: "code", label: "TSX" },
  jsx: { gradient: ["#06B6D4", "#0891B2"], iconType: "code", label: "JSX" },
  py: { gradient: ["#374151", "#1F2937"], iconType: "code", label: "PY" },
  rs: { gradient: ["#D97706", "#9A3412"], iconType: "code", label: "RS" },
  go: { gradient: ["#06B6D4", "#0284C7"], iconType: "code", label: "GO" },
  java: { gradient: ["#EF4444", "#C2410C"], iconType: "code", label: "JAVA" },
  cpp: { gradient: ["#2563EB", "#1D4ED8"], iconType: "code", label: "C++" },
  c: { gradient: ["#2563EB", "#1D4ED8"], iconType: "code", label: "C" },
  h: { gradient: ["#2563EB", "#1D4ED8"], iconType: "code", label: "H" },
  hpp: { gradient: ["#2563EB", "#1D4ED8"], iconType: "code", label: "HPP" },
  cs: { gradient: ["#8B5CF6", "#6D28D9"], iconType: "code", label: "C#" },
  php: { gradient: ["#6366F1", "#4F46E5"], iconType: "code", label: "PHP" },
  swift: { gradient: ["#F97316", "#EA580C"], iconType: "code", label: "SWIFT" },
  kt: { gradient: ["#8B5CF6", "#D946EF"], iconType: "code", label: "KT" },
  sql: { gradient: ["#4F46E5", "#3730A3"], iconType: "data", label: "SQL" },
  db: { gradient: ["#4F46E5", "#3730A3"], iconType: "data", label: "DB" },
  json: { gradient: ["#D97706", "#B45309"], iconType: "code", label: "JSON" },
  xml: { gradient: ["#6B7280", "#374151"], iconType: "code", label: "XML" },
  yaml: { gradient: ["#6B7280", "#374151"], iconType: "code", label: "YML" },
  yml: { gradient: ["#6B7280", "#374151"], iconType: "code", label: "YML" },
  html: { gradient: ["#EA580C", "#C2410C"], iconType: "code", label: "HTML" },
  css: { gradient: ["#EC4899", "#C084FC"], iconType: "code", label: "CSS" },

  // Executables/Sys
  exe: { gradient: ["#4F46E5", "#312E81"], iconType: "executable", label: "EXE" },
  msi: { gradient: ["#4F46E5", "#312E81"], iconType: "executable", label: "MSI" },
  dmg: { gradient: ["#4F46E5", "#312E81"], iconType: "executable", label: "DMG" },
  pkg: { gradient: ["#4F46E5", "#312E81"], iconType: "executable", label: "PKG" },
  apk: { gradient: ["#84CC16", "#4D7C0F"], iconType: "apk", label: "APK" },
  iso: { gradient: ["#64748B", "#475569"], iconType: "disc", label: "ISO" },
};

const CAT_MAP: Record<string, ExtensionConfig> = {
  document: { gradient: ["#3B82F6", "#1D4ED8"], iconType: "doc", label: "DOC" },
  text: { gradient: ["#6B7280", "#374151"], iconType: "doc", label: "TXT" },
  image: { gradient: ["#10B981", "#047857"], iconType: "image", label: "IMG" },
  video: { gradient: ["#8B5CF6", "#4C1D95"], iconType: "video", label: "VID" },
  audio: { gradient: ["#06B6D4", "#0891B2"], iconType: "audio", label: "AUD" },
  archive: { gradient: ["#F97316", "#C2410C"], iconType: "archive", label: "ZIP" },
  code: { gradient: ["#4B5563", "#1F2937"], iconType: "code", label: "CODE" },
  data: { gradient: ["#84CC16", "#3F6212"], iconType: "data", label: "DATA" },
  executable: { gradient: ["#475569", "#1E293B"], iconType: "executable", label: "EXE" },
  apk: { gradient: ["#a855f7", "#6b21a8"], iconType: "apk", label: "APK" },
  disc: { gradient: ["#6366f1", "#312e81"], iconType: "disc", label: "ISO" },
};

function FileBox({ gradId, colors, children, className = "w-5 h-5" }: FileBoxProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={{ overflow: "visible" }}
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={colors[0]} />
          <stop offset="100%" stopColor={colors[1]} />
        </linearGradient>
        <filter id={`${gradId}-shadow`} x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="1.5" stdDeviation="1.5" floodColor="#000000" floodOpacity="0.22" />
        </filter>
      </defs>
      
      {/* Symmetrical Rounded Box with shadow */}
      <rect
        x="1"
        y="1"
        width="30"
        height="30"
        rx="7.5"
        fill={`url(#${gradId})`}
        filter={`url(#${gradId}-shadow)`}
      />

      {/* Inner Symbol */}
      <g>
        {children}
      </g>
    </svg>
  );
}

export function FileIcon({ fileName, category, className = "w-5 h-5" }: FileIconProps) {
  let label = "FILE";
  let gradId = "defGrad";
  let colors: [string, string] = ["#94a3b8", "#475569"];
  let iconType: "doc" | "image" | "video" | "audio" | "archive" | "code" | "data" | "executable" | "apk" | "disc" | "folder" = "doc";

  let type = category || "";

  if (type === "all" || type === "folder") {
    iconType = "folder";
  } else if (CAT_MAP[type]) {
    const config = CAT_MAP[type];
    colors = config.gradient;
    iconType = config.iconType;
    label = config.label;
    gradId = `${type}Grad`;
  } else if (fileName) {
    const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
    if (EXT_MAP[ext]) {
      const config = EXT_MAP[ext];
      colors = config.gradient;
      iconType = config.iconType;
      label = config.label;
      gradId = `${ext}Grad`;
    } else {
      label = ext.toUpperCase().slice(0, 4) || "FILE";
      colors = ["#94a3b8", "#475569"];
      iconType = "doc";
      gradId = "defGrad";
    }
  }

  // Render matching SVG
  switch (iconType) {
    case "folder":
      return (
        <svg
          className={className}
          viewBox="0 0 32 28"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <defs>
            <linearGradient id="folderBackGrad" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#f59e0b" />
              <stop offset="100%" stopColor="#b45309" />
            </linearGradient>
            <linearGradient id="folderFrontGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#fbbf24" />
              <stop offset="100%" stopColor="#d97706" />
            </linearGradient>
            <filter id="folderShadow" x="-10%" y="-10%" width="120%" height="120%">
              <feDropShadow dx="0" dy="1.5" stdDeviation="1" floodOpacity="0.15" />
            </filter>
          </defs>
          {/* Back Cover & Tab */}
          <path
            d="M2 5a2 2 0 012-2h8l2.5 3H28a2 2 0 012 2v16a2 2 0 01-2 2H4a2 2 0 01-2-2V5z"
            fill="url(#folderBackGrad)"
          />
          {/* Front pocket */}
          <path
            d="M2 11h28v13a2 2 0 01-2 2H4a2 2 0 01-2-2V11z"
            fill="url(#folderFrontGrad)"
            filter="url(#folderShadow)"
          />
        </svg>
      );

    case "image":
      return (
        <FileBox gradId={gradId} colors={colors} className={className}>
          <circle cx="11" cy="12" r="2.2" fill="#ffffff" fillOpacity="0.8" />
          <path
            d="M7 23l4-4 3 3 5-5 6 6v1H7v-1z"
            fill="#ffffff"
            fillOpacity="0.85"
            stroke="#ffffff"
            strokeWidth="0.8"
            strokeLinejoin="round"
          />
        </FileBox>
      );

    case "video":
      return (
        <FileBox gradId={gradId} colors={colors} className={className}>
          <circle cx="16" cy="16" r="6" stroke="#ffffff" strokeWidth="1.5" strokeOpacity="0.85" fill="none" />
          <polygon points="14.5,13.5 19,16 14.5,18.5" fill="#ffffff" fillOpacity="0.9" />
        </FileBox>
      );

    case "audio":
      return (
        <FileBox gradId={gradId} colors={colors} className={className}>
          <path
            d="M12 21.5a2 2 0 11-2-2h2V10l8-2v6.5a2 2 0 11-2-2h2v-4.5l-6 1.5v12.5"
            fill="#ffffff"
            fillOpacity="0.85"
          />
        </FileBox>
      );

    case "archive":
      return (
        <FileBox gradId={gradId} colors={colors} className={className}>
          <path
            d="M7 11h18v11H7zm0 3h18M12 17h8"
            stroke="#ffffff"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeOpacity="0.85"
            fill="none"
          />
        </FileBox>
      );

    case "code":
      return (
        <FileBox gradId={gradId} colors={colors} className={className}>
          <path
            d="M10 12l-4 4 4 4M22 12l4 4-4 4M18 10l-4 12"
            stroke="#ffffff"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeOpacity="0.85"
          />
        </FileBox>
      );

    case "data":
      return (
        <FileBox gradId={gradId} colors={colors} className={className}>
          <ellipse cx="16" cy="11" rx="5" ry="1.8" stroke="#ffffff" strokeWidth="1.5" strokeOpacity="0.85" fill="none" />
          <path d="M11 11v3.5c0 .9 2.2 1.6 5 1.6s5-.7 5-1.6V11" stroke="#ffffff" strokeWidth="1.5" strokeOpacity="0.85" fill="none" />
          <path d="M11 14.5v3.5c0 .9 2.2 1.6 5 1.6s5-.7 5-1.6v-3.5" stroke="#ffffff" strokeWidth="1.5" strokeOpacity="0.85" fill="none" />
        </FileBox>
      );

    case "executable":
      return (
        <FileBox gradId={gradId} colors={colors} className={className}>
          <rect x="7" y="10" width="18" height="12" rx="1.5" stroke="#ffffff" strokeWidth="1.5" strokeOpacity="0.85" fill="none" />
          <path d="M10 13.5l2 1.5-2 1.5M14 16.5h4" stroke="#ffffff" strokeWidth="1.2" strokeLinecap="round" />
        </FileBox>
      );

    case "apk":
      return (
        <FileBox gradId={gradId} colors={colors} className={className}>
          <path
            d="M10 21v-3.5a6 6 0 0112 0V21H10z"
            fill="#ffffff"
            fillOpacity="0.85"
          />
          <circle cx="13" cy="15.5" r="0.8" fill="#4D7C0F" />
          <circle cx="19" cy="15.5" r="0.8" fill="#4D7C0F" />
          <path d="M12 12.5l-2-2.5M20 12.5l2-2.5" stroke="#ffffff" strokeWidth="1.2" strokeLinecap="round" strokeOpacity="0.85" />
        </FileBox>
      );

    case "disc":
      return (
        <FileBox gradId={gradId} colors={colors} className={className}>
          <circle cx="16" cy="16" r="6.5" stroke="#ffffff" strokeWidth="1.5" strokeOpacity="0.85" fill="none" />
          <circle cx="16" cy="16" r="2" stroke="#ffffff" strokeWidth="1.2" strokeOpacity="0.85" fill="none" />
        </FileBox>
      );

    case "doc":
    default:
      return (
        <FileBox gradId={gradId} colors={colors} className={className}>
          <path
            d="M8 11.5h16M8 15.5h16M8 19.5h16M8 23.5h10"
            stroke="#ffffff"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeOpacity="0.85"
          />
        </FileBox>
      );
  }
}
