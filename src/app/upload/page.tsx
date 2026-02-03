"use client";

import { useState, FormEvent, ChangeEvent } from "react";

const RESTAURANTS = [
  { value: "harveys_wings", label: "Harvey's Wings" },
  { value: "bakugo_ramen", label: "Bakugo Ramen" },
  { value: "wildflower", label: "Wildflower Tea House" },
  { value: "fika", label: "Fika Cafe" },
  { value: "harveys_chicken", label: "Harvey's Chicken" },
];

const CSV_TYPE_LABELS: Record<string, string> = {
  products: "Products / Menu Items",
  sales: "Sales / Receipts",
  inventory: "Inventory / Stock",
};

interface UploadResult {
  success?: boolean;
  message?: string;
  error?: string;
  details?: {
    filename: string;
    restaurant: string;
    csv_type: string;
    csv_type_detected?: boolean;
    rows_processed: number;
    uploaded_at: string;
  };
}

export default function UploadPage() {
  const [restaurant, setRestaurant] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [result, setResult] = useState<UploadResult | null>(null);

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0] || null;
    setFile(selectedFile);
    setResult(null);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!file || !restaurant) {
      setResult({ error: "Please select a restaurant and a file" });
      return;
    }

    setIsUploading(true);
    setResult(null);

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("restaurant", restaurant);

      const response = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });

      const data = await response.json();
      setResult(data);

      if (data.success) {
        setFile(null);
        // Reset file input
        const fileInput = document.getElementById("file-input") as HTMLInputElement;
        if (fileInput) fileInput.value = "";
      }
    } catch (error) {
      setResult({ error: "Failed to upload file. Please try again." });
      console.error("Upload error:", error);
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <h1 style={styles.title}>Upload CSV to Knowledge Base</h1>
        <p style={styles.subtitle}>
          Upload CSV files to enable RAG search across your restaurant data
        </p>

        <form onSubmit={handleSubmit} style={styles.form}>
          <div style={styles.field}>
            <label style={styles.label}>Restaurant</label>
            <select
              value={restaurant}
              onChange={(e) => setRestaurant(e.target.value)}
              style={styles.select}
              disabled={isUploading}
            >
              <option value="">Select a restaurant...</option>
              {RESTAURANTS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>

          <div style={styles.field}>
            <label style={styles.label}>CSV File</label>
            <input
              id="file-input"
              type="file"
              accept=".csv"
              onChange={handleFileChange}
              style={styles.fileInput}
              disabled={isUploading}
            />
            {file && (
              <p style={styles.fileName}>Selected: {file.name}</p>
            )}
          </div>

          <button
            type="submit"
            style={{
              ...styles.button,
              ...(isUploading ? styles.buttonDisabled : {}),
            }}
            disabled={isUploading}
          >
            {isUploading ? "Uploading..." : "Upload CSV"}
          </button>
        </form>

        {result && (
          <div
            style={{
              ...styles.result,
              ...(result.success ? styles.resultSuccess : styles.resultError),
            }}
          >
            {result.success ? (
              <>
                <p style={styles.resultTitle}>{result.message}</p>
                {result.details && (
                  <ul style={styles.detailsList}>
                    <li>File: {result.details.filename}</li>
                    <li>Restaurant: {result.details.restaurant}</li>
                    <li>
                      Type: {CSV_TYPE_LABELS[result.details.csv_type] || result.details.csv_type}
                      {result.details.csv_type_detected && " (auto-detected)"}
                    </li>
                    <li>Rows: {result.details.rows_processed}</li>
                  </ul>
                )}
              </>
            ) : (
              <p style={styles.resultTitle}>{result.error}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f5f5f5",
    padding: "20px",
  },
  card: {
    backgroundColor: "white",
    borderRadius: "12px",
    padding: "40px",
    maxWidth: "500px",
    width: "100%",
    boxShadow: "0 4px 6px rgba(0, 0, 0, 0.1)",
  },
  title: {
    fontSize: "24px",
    fontWeight: "bold",
    marginBottom: "8px",
    color: "#333",
  },
  subtitle: {
    fontSize: "14px",
    color: "#666",
    marginBottom: "32px",
  },
  form: {
    display: "flex",
    flexDirection: "column",
    gap: "20px",
  },
  field: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
  },
  label: {
    fontSize: "14px",
    fontWeight: "500",
    color: "#333",
  },
  select: {
    padding: "12px",
    fontSize: "14px",
    border: "1px solid #ddd",
    borderRadius: "8px",
    backgroundColor: "white",
    cursor: "pointer",
  },
  fileInput: {
    padding: "12px",
    fontSize: "14px",
    border: "1px solid #ddd",
    borderRadius: "8px",
    backgroundColor: "#fafafa",
  },
  fileName: {
    fontSize: "12px",
    color: "#666",
    marginTop: "4px",
  },
  button: {
    padding: "14px",
    fontSize: "16px",
    fontWeight: "500",
    backgroundColor: "#0070f3",
    color: "white",
    border: "none",
    borderRadius: "8px",
    cursor: "pointer",
    marginTop: "12px",
  },
  buttonDisabled: {
    backgroundColor: "#ccc",
    cursor: "not-allowed",
  },
  result: {
    marginTop: "24px",
    padding: "16px",
    borderRadius: "8px",
  },
  resultSuccess: {
    backgroundColor: "#e6f7e6",
    border: "1px solid #4caf50",
  },
  resultError: {
    backgroundColor: "#ffeaea",
    border: "1px solid #f44336",
  },
  resultTitle: {
    fontWeight: "500",
    marginBottom: "8px",
  },
  detailsList: {
    fontSize: "14px",
    color: "#666",
    paddingLeft: "20px",
    margin: 0,
  },
};
