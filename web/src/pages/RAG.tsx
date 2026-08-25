import { useState, useEffect } from 'react';
import { getRagDocuments, uploadRagDocument, deleteRagDocument } from '../api/client';
import toast from 'react-hot-toast';

interface Document {
  id: string;
  title: string;
  sourcePath: string;
  chunkCount: number;
  createdAt: string;
}

export function RAGPage() {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const data = await getRagDocuments();
        setDocuments(data.documents);
      } catch (err) {
        toast.error('Failed to load documents');
      } finally {
        setIsLoading(false);
      }
    };
    load();
  }, []);

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFile) {
      toast.error('Please select a file');
      return;
    }

    setIsUploading(true);
    try {
      const res = await uploadRagDocument(selectedFile) as { document: Document };
      setDocuments((prev) => [...prev, res.document]);
      setSelectedFile(null);
      toast.success('Document uploaded and ingested');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to upload document';
      toast.error(msg);
    } finally {
      setIsUploading(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteRagDocument(id);
      setDocuments((prev) => prev.filter((d) => d.id !== id));
      toast.success('Document deleted');
    } catch (err) {
      toast.error('Failed to delete document');
    }
  };

  return (
    <div>
      <h1 style={{ marginBottom: '2rem' }}>RAG Documents</h1>

      {/* Upload form */}
      <div className="card" style={{ marginBottom: '2rem' }}>
        <h3 style={{ marginBottom: '1rem' }}>Upload New Document</h3>
        <form onSubmit={handleUpload}>
          <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-end' }}>
            <div className="form-group" style={{ flex: 1 }}>
              <label>PDF or Text File</label>
              <input
                type="file"
                accept=".pdf,.txt,.md"
                onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                disabled={isUploading}
              />
              <p style={{ fontSize: '0.85rem', color: 'var(--text-dim)', marginTop: '0.5rem' }}>
                Supported: PDF, TXT, Markdown
              </p>
            </div>
            <button
              type="submit"
              className="primary"
              disabled={!selectedFile || isUploading}
            >
              {isUploading ? 'Uploading...' : 'Upload'}
            </button>
          </div>
        </form>
      </div>

      {/* Documents list */}
      {isLoading ? (
        <div className="loading">
          <div className="spinner" />
          Loading documents...
        </div>
      ) : documents.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">📄</div>
          <p>No documents uploaded yet</p>
        </div>
      ) : (
        <div>
          <h3 style={{ marginBottom: '1rem' }}>Documents ({documents.length})</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '1rem' }}>
            {documents.map((doc) => (
              <div key={doc.id} className="card">
                <h4 style={{ marginBottom: '0.5rem' }}>{doc.title}</h4>
                <p style={{ fontSize: '0.85rem', color: 'var(--text-dim)', marginBottom: '0.75rem', wordBreak: 'break-word' }}>
                  {doc.sourcePath}
                </p>
                <div style={{ fontSize: '0.85rem', marginBottom: '1rem' }}>
                  <div style={{ color: 'var(--info)', marginBottom: '0.25rem' }}>
                    {doc.chunkCount} chunk{doc.chunkCount !== 1 ? 's' : ''}
                  </div>
                  <div style={{ color: 'var(--text-dim)' }}>
                    {new Date(doc.createdAt).toLocaleDateString()}
                  </div>
                </div>
                <button
                  onClick={() => handleDelete(doc.id)}
                  className="error"
                  style={{ width: '100%' }}
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
