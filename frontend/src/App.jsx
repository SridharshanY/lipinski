import axios from 'axios';
import { useState, useEffect } from 'react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

export default function App() {
  const [activeTab, setActiveTab] = useState('single');
  const [smiles, setSmiles] = useState("");
  const [files, setFiles] = useState([]);
  const [result, setResult] = useState(null);
  const [fileResults, setFileResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  
  const API_URL = import.meta.env.VITE_API_URL || "http://localhost:4000";
  const [retrying, setRetrying] = useState(false);

  // Keep services warm: ping every 10 minutes while page is open
  useEffect(() => {
    const warmup = () => axios.get(`${API_URL}/warmup`).catch(() => {});
    warmup(); // initial ping on load
    const interval = setInterval(warmup, 10 * 60 * 1000); // every 10 min
    return () => clearInterval(interval);
  }, []);

  const handleCheck = async () => {
    if (!smiles) return;
    setLoading(true);
    setError(null);
    setResult(null);
    setFileResults([]);
    try {
      const res = await axios.post(`${API_URL}/api/check`, { smiles });
      setResult(res.data);
    } catch (err) {
      if (err.response?.status >= 500) {
        // Auto-retry once after waking the service
        setRetrying(true);
        setError("Services woke up, retrying…");
        await axios.get(`${API_URL}/warmup`).catch(() => {});
        await new Promise(r => setTimeout(r, 5000));
        try {
          const res = await axios.post(`${API_URL}/api/check`, { smiles });
          setResult(res.data);
          setError(null);
        } catch (retryErr) {
          setError(retryErr.response?.data?.error || "Failed after retry. Please try again.");
        } finally {
          setRetrying(false);
        }
      } else {
        setError(err.response?.data?.error || "Failed to analyze SMILES");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleFileChange = (e) => {
    if (e.target.files) {
      setFiles(Array.from(e.target.files));
    }
  };

  const handleFileUpload = async () => {
    if (files.length === 0) return;
    setLoading(true);
    setError(null);
    setResult(null);
    setFileResults([]);
    
    const buildForm = () => {
      const formData = new FormData();
      files.forEach(file => formData.append("files", file));
      return formData;
    };

    try {
      const res = await axios.post(`${API_URL}/api/upload`, buildForm());
      setFileResults(res.data);
    } catch (err) {
      if (err.response?.status >= 500) {
        // Auto-retry once after waking the service
        setRetrying(true);
        setError("Services woke up, retrying…");
        await axios.get(`${API_URL}/warmup`).catch(() => {});
        await new Promise(r => setTimeout(r, 5000));
        try {
          const res = await axios.post(`${API_URL}/api/upload`, buildForm());
          setFileResults(res.data);
          setError(null);
        } catch (retryErr) {
          setError(retryErr.response?.data?.error || "Failed after retry. Please try again.");
        } finally {
          setRetrying(false);
        }
      } else {
        setError(err.response?.data?.error || "Failed to upload file");
      }
    } finally {
      setLoading(false);
    }
  };

  const downloadPDF = () => {
    const data = result ? [result] : fileResults;
    if (!data.length) return;

    const doc = new jsPDF();
    const currentDate = new Date().toLocaleString();

    // Report Header
    doc.setFont("helvetica", "bold");
    doc.setFontSize(22);
    doc.setTextColor(0, 102, 204);
    doc.text("Lipinski Rule of 5 Analysis Report", 14, 20);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(100, 100, 100);
    doc.text(`Generated on: ${currentDate}`, 14, 28);
    
    // Separator line
    doc.setDrawColor(200, 200, 200);
    doc.line(14, 32, 196, 32);

    let startY = 40;

    // Single Molecule Regular Info
    if (result) {
      doc.setFontSize(14);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(40, 40, 40);
      doc.text("Molecule Details", 14, startY);
      
      doc.setFontSize(11);
      doc.setFont("helvetica", "normal");
      doc.text(`Identifier: ${result.Identifier}`, 14, startY + 8);
      doc.text(`Formula: ${result.Formula}`, 14, startY + 14);
      
      doc.setFontSize(9);
      doc.text("SMILES:", 14, startY + 20);
      
      // Auto-wrap SMILES text in case it's long
      const splitSmiles = doc.splitTextToSize(result.Smiles, 180);
      doc.text(splitSmiles, 14, startY + 24);
      
      startY = startY + 24 + (splitSmiles.length * 4) + 10;
    } else {
      doc.setFontSize(12);
      doc.setTextColor(40, 40, 40);
      doc.text(`Batch Analysis: Processing details for ${data.length} molecules.`, 14, startY);
      startY += 10;
    }

    // Properties Table
    doc.setFontSize(14);
    doc.setFont("helvetica", "bold");
    doc.text("Physicochemical Properties", 14, startY);

    const tableHeaders = [["Molecule", "MW", "LogP", "H-Donors", "H-Acceptors", "TPSA", "Status"]];
    const tableBody = data.map(r => [
      r.Identifier || r.Formula || "-",
      r.MW?.toFixed(2),
      r.LogP?.toFixed(2),
      r.HDonors,
      r.HAcceptors,
      r.TPSA?.toFixed(2) || "-",
      r.Pass ? "PASS" : "FAIL"
    ]);

    autoTable(doc, {
      startY: startY + 5,
      head: tableHeaders,
      body: tableBody,
      theme: 'grid',
      styles: { cellPadding: 2, fontSize: 9 },
      headStyles: { fillColor: [15, 23, 42], textColor: [255, 255, 255], fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [240, 248, 255] },
      didParseCell: function(data) {
        if (data.section === 'body' && data.column.index === 6) {
          if (data.cell.raw === 'PASS') {
            data.cell.styles.textColor = [0, 150, 0];
            data.cell.styles.fontStyle = 'bold';
          } else {
            data.cell.styles.textColor = [200, 0, 0];
            data.cell.styles.fontStyle = 'bold';
          }
        }
      }
    });

    const finalY = doc.lastAutoTable.finalY || startY + 20;
    
    if (result) {
      doc.setFontSize(12);
      doc.setFont("helvetica", "italic");
      doc.setTextColor(60, 60, 60);
      const conclusion = result.Pass 
        ? "Conclusion: The molecule complies with Lipinski's Rule of 5 and is likely to be orally active."
        : "Conclusion: The molecule violates Lipinski's limitations and may suffer from poor oral bioavailability.";
      doc.text(conclusion, 14, finalY + 15);
    }

    doc.save(result ? "lipinski_report.pdf" : "lipinski_batch_report.pdf");
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900 text-slate-100 flex flex-col items-center p-8">
      
      <div className="max-w-5xl w-full flex flex-col gap-8">
        <header className="text-center space-y-4">
          <h1 className="text-5xl font-extrabold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-cyan-300 drop-shadow-sm">
            Lipinski Rule of 5 Checker
          </h1>
          <p className="text-blue-200 text-lg max-w-2xl mx-auto">
            Evaluate drug-likeness instantly. Choose to analyze a single SMILES string or upload an SDF/MOL file for batch processing.
          </p>
        </header>

        {/* Tab Navigation */}
        <div className="flex justify-center mt-4">
          <div className="bg-slate-800/50 p-1 rounded-xl flex gap-2 border border-slate-700/50">
            <button 
              onClick={() => setActiveTab('single')}
              className={`px-6 py-2 rounded-lg font-semibold transition-all ${activeTab === 'single' ? 'bg-cyan-500 text-slate-900 shadow-md shadow-cyan-500/20' : 'text-slate-300 hover:text-white hover:bg-slate-700/50'}`}
            >
              Single Molecule
            </button>
            <button 
              onClick={() => setActiveTab('batch')}
              className={`px-6 py-2 rounded-lg font-semibold transition-all ${activeTab === 'batch' ? 'bg-blue-500 text-slate-900 shadow-md shadow-blue-500/20' : 'text-slate-300 hover:text-white hover:bg-slate-700/50'}`}
            >
              Batch Processing
            </button>
          </div>
        </div>

        <main className="w-full max-w-2xl mx-auto">
          {activeTab === 'single' && (
            <section className="glass-panel p-8 flex flex-col space-y-6 animate-fade-in shadow-xl shadow-cyan-900/20">
              <div className="text-center">
                <h2 className="text-2xl font-bold mb-2 text-cyan-100">Enter SMILES</h2>
                <p className="text-sm text-slate-400">Evaluate a specific compound via its descriptive string</p>
              </div>
              <input
                value={smiles}
                onChange={(e) => setSmiles(e.target.value)}
                placeholder="e.g. C1=CC=C(C=C1)O"
                className="w-full bg-slate-900/70 border border-slate-600 rounded-lg py-4 px-4 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500 text-center font-mono tracking-wide"
                onKeyDown={(e) => e.key === 'Enter' && handleCheck()}
              />
              <button
                onClick={handleCheck}
                disabled={loading || !smiles}
                className="w-full py-4 rounded-lg font-bold bg-gradient-to-r from-cyan-500 to-blue-600 text-white shadow-lg hover:shadow-cyan-500/40 hover:from-cyan-400 hover:to-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all uppercase tracking-wider"
              >
                {loading ? (retrying ? "Waking services, retrying…" : "Analyzing...") : "Analyze Molecule"}
              </button>
            </section>
          )}

          {activeTab === 'batch' && (
            <section className="glass-panel p-8 flex flex-col space-y-6 animate-fade-in shadow-xl shadow-blue-900/20">
              <div className="text-center">
                <h2 className="text-2xl font-bold mb-2 text-blue-100">Upload Molecules</h2>
                <p className="text-sm text-slate-400">Process multiple compounds via .mol or .sdf formats</p>
              </div>
              
              <div className="flex flex-col items-center">
                <label className={`w-full cursor-pointer flex flex-col items-center justify-center py-10 rounded-xl border-2 border-dashed transition-all ${files.length > 0 ? 'border-emerald-500 bg-emerald-900/10' : 'border-slate-600 bg-slate-900/50 hover:bg-slate-800 hover:border-blue-400'}`}>
                  <span className={`font-semibold mb-1 ${files.length > 0 ? 'text-emerald-400' : 'text-slate-300'}`}>
                    {files.length > 0 ? `${files.length} file(s) selected` : "Click to select files"}
                  </span>
                  <span className="text-xs text-slate-500">{files.length > 0 ? files.map(f => f.name).join(", ").substring(0, 50) + (files.map(f => f.name).join(", ").length > 50 ? '...' : '') : 'Supported: SDF, MOL (Multiple uploads allowed)'}</span>
                  <input type="file" className="hidden" accept=".sdf,.mol" multiple onChange={handleFileChange} />
                </label>
              </div>

              <button
                onClick={handleFileUpload}
                disabled={loading || files.length === 0}
                className="w-full py-4 rounded-lg font-bold bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-lg hover:shadow-blue-500/40 hover:from-blue-500 hover:to-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all uppercase tracking-wider"
              >
                {loading ? (retrying ? "Waking services, retrying…" : "Processing File...") : "Analyze File"}
              </button>
            </section>
          )}
        </main>

        <section className="w-full transition-all duration-500 ease-in-out">
          {retrying && (
            <div className="max-w-2xl mx-auto glass-panel bg-amber-900/40 border-amber-500/50 p-4 text-center text-amber-200 mb-2">
              ⏳ Service was asleep — waking it up and retrying automatically…
            </div>
          )}
          {error && !retrying && (
            <div className="max-w-2xl mx-auto glass-panel bg-red-900/40 border-red-500/50 p-6 text-center text-red-200 shadow-[0_0_15px_rgba(239,68,68,0.2)] animate-pulse">
              <span className="font-semibold">{error}</span>
            </div>
          )}

          {(result || fileResults.length > 0) && (
            <div className="mb-6 flex justify-end animate-fade-in w-full max-w-5xl mx-auto">
              <button 
                onClick={downloadPDF}
                className="flex items-center gap-2 px-6 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-600 text-cyan-300 rounded-lg shadow transition-colors font-medium text-sm"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
                Download PDF Report
              </button>
            </div>
          )}

          {result && (
            <div className="glass-panel p-8 w-full animate-fade-in max-w-5xl mx-auto">
              <div className="flex flex-col md:flex-row items-center justify-between border-b border-slate-700 pb-6 mb-6">
                <div>
                  <h3 className="text-3xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-cyan-300 to-blue-400">Detailed Analysis</h3>
                  <div className="mt-2 space-y-1 text-sm text-slate-400 font-mono">
                    <p><span className="text-slate-500">Identifier:</span> {result.Identifier}</p>
                    <p><span className="text-slate-500">Formula:</span> <span className="text-blue-300">{result.Formula}</span></p>
                    <p className="break-all"><span className="text-slate-500">SMILES:</span> {result.Smiles}</p>
                  </div>
                </div>
                <div className="mt-6 md:mt-0">
                  <div className={`px-6 py-3 rounded-full font-bold text-lg shadow-xl border flex items-center gap-2 ${result.Pass ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/50' : 'bg-red-500/10 text-red-400 border-red-500/50'}`}>
                    {result.Pass ? "✅ PASSED LIPINSKI" : "❌ FAILED LIPINSKI"}
                  </div>
                </div>
              </div>
              
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4 text-center">
                <ResultWidget label="Weight" value={result.MW?.toFixed(2)} limit="< 500 Da" isPass={result.MW <= 500} />
                <ResultWidget label="LogP" value={result.LogP?.toFixed(2)} limit="< 5.0" isPass={result.LogP <= 5} />
                <ResultWidget label="H-Donors" value={result.HDonors} limit="< 5" isPass={result.HDonors <= 5} />
                <ResultWidget label="H-Acceptors" value={result.HAcceptors} limit="< 10" isPass={result.HAcceptors <= 10} />
                <ResultWidget label="TPSA" value={result.TPSA?.toFixed(1)} limit="Optional info" isPass={true} neutral={true} />
                <ResultWidget label="Rotatable" value={result.RotatableBonds} limit="Optional info" isPass={true} neutral={true} />
              </div>
            </div>
          )}

          {fileResults.length > 0 && (
            <div className="glass-panel overflow-hidden animate-fade-in shadow-2xl max-w-5xl mx-auto">
              <div className="overflow-x-auto max-h-[600px] custom-scrollbar">
                <table className="w-full text-sm text-left whitespace-nowrap">
                  <thead className="text-xs uppercase bg-slate-900/90 text-cyan-300 border-b border-slate-700 sticky top-0 z-10 shadow-sm">
                    <tr>
                      <th className="px-6 py-4 font-bold tracking-wider">Molecule</th>
                      <th className="px-6 py-4 font-bold tracking-wider">Formula</th>
                      <th className="px-6 py-4 font-bold tracking-wider">Weight</th>
                      <th className="px-6 py-4 font-bold tracking-wider">LogP</th>
                      <th className="px-6 py-4 font-bold tracking-wider">H-Don.</th>
                      <th className="px-6 py-4 font-bold tracking-wider">H-Acc.</th>
                      <th className="px-6 py-4 font-bold tracking-wider">TPSA</th>
                      <th className="px-6 py-4 font-bold tracking-wider rounded-tr-xl text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fileResults.map((r, i) => (
                      <tr key={i} className="border-b border-slate-800/50 hover:bg-slate-800/80 transition-colors">
                        <td className="px-6 py-3 font-mono text-xs text-blue-200 truncate max-w-[150px]">{r.Identifier}</td>
                        <td className="px-6 py-3 font-mono text-cyan-200">{r.Formula}</td>
                        <td className={`px-6 py-3 ${r.MW > 500 ? 'text-red-400 font-bold' : ''}`}>{r.MW?.toFixed(2)}</td>
                        <td className={`px-6 py-3 ${r.LogP > 5 ? 'text-red-400 font-bold' : ''}`}>{r.LogP?.toFixed(2)}</td>
                        <td className={`px-6 py-3 ${r.HDonors > 5 ? 'text-red-400 font-bold' : ''}`}>{r.HDonors}</td>
                        <td className={`px-6 py-3 ${r.HAcceptors > 10 ? 'text-red-400 font-bold' : ''}`}>{r.HAcceptors}</td>
                        <td className="px-6 py-3 text-slate-400">{r.TPSA?.toFixed(1)}</td>
                        <td className="px-6 py-3 text-center">
                          {r.Pass ? (
                            <span className="bg-emerald-500/20 text-emerald-400 py-1 px-3 rounded-full text-xs font-bold border border-emerald-500/30">PASS</span>
                          ) : (
                            <span className="bg-red-500/20 text-red-400 py-1 px-3 rounded-full text-xs font-bold border border-red-500/30">FAIL</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>
      </div>

    </div>
  );
}

function ResultWidget({ label, value, limit, isPass, neutral }) {
  if (neutral) {
    return (
      <div className={`p-4 rounded-xl border bg-slate-800/40 border-slate-600/50 flex flex-col items-center justify-center transition-all shadow-inner`}>
        <span className="text-xs text-slate-400 mb-1 font-semibold tracking-wide uppercase">{label}</span>
        <span className="text-2xl font-black mb-1 text-blue-200 truncate max-w-[150px]">{value}</span>
        {limit && <span className="text-[9px] text-slate-500 tracking-wider font-mono">{limit}</span>}
      </div>
    );
  }
  return (
    <div className={`p-4 rounded-xl border shadow-lg flex flex-col items-center justify-center transition-all ${isPass ? 'bg-emerald-900/20 border-emerald-500/30 shadow-emerald-900/20' : 'bg-red-900/20 border-red-500/40 shadow-red-900/20'}`}>
      <span className="text-xs text-slate-300 mb-1 font-semibold tracking-wide uppercase">{label}</span>
      <span className={`text-3xl font-black mb-1 ${isPass ? 'text-emerald-400' : 'text-red-400'}`}>{value}</span>
      {limit && <span className="text-[9px] text-slate-400 tracking-wider font-mono">LIMIT: {limit}</span>}
    </div>
  );
}
