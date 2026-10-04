import React, { useState, useEffect, useMemo } from 'react';
import {
  History,
  X,
  Search,
  Calendar,
  AlertTriangle,
  Clock,
  CheckCircle2,
  Copy,
  Check,
  Share2,
  Trash2,
  RefreshCw,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  FileText,
  User,
  Database,
  Pill,
  Sparkles,
  ArrowRight,
} from 'lucide-react';
import type { StoredConsultation } from '../firebase';

interface ConsultationHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  uid?: string | null;
  deviceId?: string | null;
  userName?: string;
  whatsappNumber?: string;
  onSelectConsultationForChat?: (consultation: StoredConsultation) => void;
  onSendConsultationToWhatsapp?: (consultation: StoredConsultation) => void;
}

export const ConsultationHistoryModal: React.FC<ConsultationHistoryModalProps> = ({
  isOpen,
  onClose,
  uid,
  deviceId,
  userName,
  whatsappNumber,
  onSelectConsultationForChat,
  onSendConsultationToWhatsapp,
}) => {
  const [consultations, setConsultations] = useState<StoredConsultation[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedUrgency, setSelectedUrgency] = useState<string>('all');
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [dataSource, setDataSource] = useState<'firestore' | 'server' | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Fetch consultations from Firestore and server fallback
  const fetchConsultations = async () => {
    setIsLoading(true);
    setError(null);

    let items: StoredConsultation[] = [];
    let source: 'firestore' | 'server' = 'server';

    // 1. If authenticated with Firebase UID, attempt Firestore first
    if (uid) {
      try {
        const { fetchConsultationsFromDatabase } = await import('../firebase');
        items = await fetchConsultationsFromDatabase(uid);
        if (items && items.length > 0) {
          source = 'firestore';
        }
      } catch (fbErr) {
        console.warn('Firestore fetch notice, falling back to server database:', fbErr);
      }
    }

    // 2. Fallback / supplementary check from server persistent database
    if (items.length === 0) {
      try {
        const params = new URLSearchParams();
        if (uid) params.append('uid', uid);
        if (deviceId) params.append('deviceId', deviceId);

        const res = await fetch(`/api/consultations?${params.toString()}`);
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data.consultations)) {
            items = data.consultations;
            source = 'server';
          }
        }
      } catch (servErr) {
        console.warn('Server consultations fetch error:', servErr);
      }
    }

    setConsultations(items);
    setDataSource(source);
    setIsLoading(false);

    // Expand latest consultation by default if exists
    if (items.length > 0) {
      setExpandedIds((prev) => ({ ...prev, [items[0].id]: true }));
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchConsultations();
    }
  }, [isOpen, uid, deviceId]);

  // Toggle card expansion
  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  };

  // Copy care regimen text
  const handleCopy = (consultation: StoredConsultation) => {
    const textToCopy = `🩺 DERMASNAP TRIAGE & CARE REGIMEN
Patient: ${consultation.patientName}
Date: ${new Date(consultation.createdAt).toLocaleString()}
Urgency: ${consultation.urgency || 'Routine'}

Reported Concern:
${consultation.text || 'None specified'}

Care Regimen & Medications:
${consultation.summary || 'No summary available.'}`;

    navigator.clipboard.writeText(textToCopy).then(() => {
      setCopiedId(consultation.id);
      setTimeout(() => setCopiedId(null), 2500);
    });
  };

  // Delete consultation record
  const handleDelete = async (consultation: StoredConsultation) => {
    if (!window.confirm('Are you sure you want to remove this consultation from your history?')) {
      return;
    }

    setDeletingId(consultation.id);
    try {
      // Delete from Firestore if owner
      if (uid) {
        try {
          const { deleteConsultationFromDatabase } = await import('../firebase');
          await deleteConsultationFromDatabase(uid, consultation.id);
        } catch (e) {
          console.warn('Firestore delete note:', e);
        }
      }

      // Delete from server DB
      await fetch(`/api/consultations/${consultation.id}`, {
        method: 'DELETE',
      });

      setConsultations((prev) => prev.filter((c) => c.id !== consultation.id));
    } catch (err) {
      console.error('Failed to delete consultation:', err);
    } finally {
      setDeletingId(null);
    }
  };

  // Filter and search
  const filteredConsultations = useMemo(() => {
    return consultations.filter((c) => {
      // Urgency filter
      if (selectedUrgency !== 'all') {
        const u = (c.urgency || 'routine').toLowerCase();
        if (selectedUrgency === 'urgent' && !u.includes('urgent')) return false;
        if (selectedUrgency === 'soon' && !u.includes('soon')) return false;
        if (selectedUrgency === 'routine' && (u.includes('urgent') || u.includes('soon'))) return false;
      }

      // Query filter
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      const matchText = (c.text || '').toLowerCase().includes(q);
      const matchSummary = (c.summary || '').toLowerCase().includes(q);
      const matchPatient = (c.patientName || '').toLowerCase().includes(q);
      const matchUrgency = (c.urgency || '').toLowerCase().includes(q);
      return matchText || matchSummary || matchPatient || matchUrgency;
    });
  }, [consultations, selectedUrgency, searchQuery]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-3 sm:p-5">
      <div className="bg-white rounded-3xl max-w-3xl w-full max-h-[90vh] flex flex-col shadow-2xl border border-slate-200 overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/80 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-teal-600 text-white flex items-center justify-center shadow-sm shadow-teal-600/30">
              <History className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-slate-900">Consultation History</h3>
                <span className="px-2 py-0.5 rounded-full bg-teal-100 text-teal-800 text-[11px] font-bold">
                  {consultations.length} {consultations.length === 1 ? 'record' : 'records'}
                </span>
                {dataSource && (
                  <span className="hidden sm:inline-flex items-center gap-1 text-[10px] text-slate-400 font-medium">
                    <Database className="w-3 h-3 text-teal-600" />
                    <span>{dataSource === 'firestore' ? 'Cloud Firestore' : 'Server Database'}</span>
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Review past skin triage assessments, diagnostic possibilities, and prescribed care regimens
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={fetchConsultations}
              disabled={isLoading}
              className="p-2 hover:bg-slate-200 rounded-xl text-slate-500 hover:text-slate-800 transition-colors cursor-pointer"
              title="Refresh history from database"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin text-teal-600' : ''}`} />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-2 hover:bg-slate-200 rounded-xl text-slate-400 hover:text-slate-700 transition-colors cursor-pointer"
              title="Close modal"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Filter and Search Bar */}
        <div className="p-4 border-b border-slate-100 bg-white space-y-3 shrink-0">
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
            {/* Search Input */}
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by symptoms (e.g. eczema, rash, steroid, itching)..."
                className="w-full pl-9 pr-8 py-2 rounded-xl border border-slate-200 text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Urgency Filter Tabs */}
            <div className="flex items-center p-1 bg-slate-100 rounded-xl gap-1 shrink-0 self-start sm:self-auto">
              {[
                { id: 'all', label: 'All' },
                { id: 'urgent', label: 'Urgent' },
                { id: 'soon', label: 'Soon' },
                { id: 'routine', label: 'Routine' },
              ].map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setSelectedUrgency(tab.id)}
                  className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                    selectedUrgency === tab.id
                      ? 'bg-white text-teal-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Scrollable Consultations List */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4 bg-slate-50/50">
          {/* Loading State */}
          {isLoading && (
            <div className="py-16 text-center space-y-3">
              <div className="w-10 h-10 border-3 border-teal-600 border-t-transparent rounded-full animate-spin mx-auto" />
              <p className="text-xs font-semibold text-slate-600">Fetching past consultations from database...</p>
            </div>
          )}

          {/* Empty State */}
          {!isLoading && filteredConsultations.length === 0 && (
            <div className="py-14 px-4 text-center max-w-md mx-auto space-y-4">
              <div className="w-14 h-14 rounded-2xl bg-teal-50 border border-teal-100 text-teal-600 flex items-center justify-center mx-auto">
                <FileText className="w-7 h-7" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-slate-800">
                  {searchQuery || selectedUrgency !== 'all' ? 'No matching consultations found' : 'No past consultations recorded'}
                </h4>
                <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                  {searchQuery || selectedUrgency !== 'all'
                    ? 'Try clearing your search query or switching urgency filter tabs.'
                    : 'Whenever you describe symptoms or upload a skin photo in DermaSnap, the clinical assessment and care regimen will be automatically saved here.'}
                </p>
              </div>

              {(searchQuery || selectedUrgency !== 'all') ? (
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery('');
                    setSelectedUrgency('all');
                  }}
                  className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-xl text-xs font-semibold transition-colors cursor-pointer"
                >
                  Clear Filters
                </button>
              ) : (
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer shadow-md shadow-teal-600/20"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Start a New Consultation</span>
                </button>
              )}
            </div>
          )}

          {/* Consultation Cards */}
          {!isLoading &&
            filteredConsultations.map((consultation) => {
              const isExpanded = Boolean(expandedIds[consultation.id]);
              const urgencyLower = (consultation.urgency || 'routine').toLowerCase();

              // Urgency formatting
              let badgeColor = 'bg-teal-50 text-teal-700 border-teal-200';
              let badgeIcon = <CheckCircle2 className="w-3 h-3 text-teal-600" />;
              if (urgencyLower.includes('urgent')) {
                badgeColor = 'bg-rose-50 text-rose-700 border-rose-200';
                badgeIcon = <AlertTriangle className="w-3 h-3 text-rose-600" />;
              } else if (urgencyLower.includes('soon')) {
                badgeColor = 'bg-amber-50 text-amber-700 border-amber-200';
                badgeIcon = <Clock className="w-3 h-3 text-amber-600" />;
              }

              // Format date nicely
              let dateStr = 'Recent';
              try {
                const dateObj = new Date(consultation.createdAt);
                if (!isNaN(dateObj.getTime())) {
                  dateStr = dateObj.toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                    hour: 'numeric',
                    minute: '2-digit',
                  });
                }
              } catch {
                dateStr = 'Recent';
              }

              return (
                <div
                  key={consultation.id}
                  className="bg-white rounded-2xl border border-slate-200/90 shadow-xs hover:shadow-md transition-all overflow-hidden"
                >
                  {/* Card Header (Clickable to Expand) */}
                  <div
                    onClick={() => toggleExpand(consultation.id)}
                    className="p-4 flex items-start sm:items-center justify-between gap-3 cursor-pointer hover:bg-slate-50/80 transition-colors select-none"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 mb-1.5">
                        <span
                          className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold border ${badgeColor}`}
                        >
                          {badgeIcon}
                          <span>{consultation.urgency || 'Routine'}</span>
                        </span>

                        <span className="flex items-center gap-1 text-[11px] text-slate-400 font-medium">
                          <Calendar className="w-3 h-3 text-slate-400" />
                          <span>{dateStr}</span>
                        </span>

                        <span className="text-[11px] text-slate-500 font-medium hidden sm:inline">
                          • Patient: <strong className="text-slate-700">{consultation.patientName}</strong>
                        </span>
                      </div>

                      {/* Symptoms teaser */}
                      <p className="text-xs text-slate-700 font-medium line-clamp-1">
                        {consultation.text ? (
                          <span>Concern: "{consultation.text}"</span>
                        ) : (
                          <span className="italic text-slate-400">Photo-based visual skin triage</span>
                        )}
                      </p>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleExpand(consultation.id);
                        }}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"
                        title={isExpanded ? 'Collapse' : 'Expand details'}
                      >
                        {isExpanded ? (
                          <ChevronUp className="w-4 h-4" />
                        ) : (
                          <ChevronDown className="w-4 h-4" />
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Expanded Consultation Details */}
                  {isExpanded && (
                    <div className="border-t border-slate-100 p-4 sm:p-5 bg-slate-50/40 space-y-4 animate-in fade-in duration-150">
                      {/* Patient Meta */}
                      <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600 bg-white p-3 rounded-xl border border-slate-200/80">
                        <span className="flex items-center gap-1.5 font-medium">
                          <User className="w-3.5 h-3.5 text-teal-600" />
                          <span>Patient: <strong>{consultation.patientName}</strong></span>
                        </span>
                        {consultation.whatsappNumber && (
                          <span className="flex items-center gap-1 text-slate-500">
                            • WhatsApp: <strong>{consultation.whatsappNumber}</strong>
                          </span>
                        )}
                      </div>

                      {/* Patient Reported Symptoms Box */}
                      {consultation.text && (
                        <div className="bg-teal-50/50 border border-teal-100 rounded-xl p-3 text-xs text-slate-700">
                          <p className="text-[11px] font-bold text-teal-900 mb-1 uppercase tracking-wider">
                            Reported Symptoms / Case Presentation:
                          </p>
                          <p className="leading-relaxed text-slate-800">{consultation.text}</p>
                        </div>
                      )}

                      {/* Clinical Triage & Care Regimen */}
                      <div>
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                            <Pill className="w-3.5 h-3.5 text-teal-600" />
                            <span>Clinical Triage & Prescribed Care Regimen:</span>
                          </span>
                        </div>

                        <div className="bg-white border border-slate-200 rounded-xl p-4 text-xs text-slate-800 whitespace-pre-wrap font-sans leading-relaxed shadow-2xs max-h-96 overflow-y-auto">
                          {consultation.summary || 'No care regimen recorded for this consultation.'}
                        </div>
                      </div>

                      {/* Action Bar */}
                      <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-200/60">
                        <div className="flex items-center gap-2">
                          {/* Copy Regimen Button */}
                          <button
                            type="button"
                            onClick={() => handleCopy(consultation)}
                            className="px-3 py-1.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer shadow-2xs"
                          >
                            {copiedId === consultation.id ? (
                              <>
                                <Check className="w-3.5 h-3.5 text-emerald-600" />
                                <span className="text-emerald-700">Copied!</span>
                              </>
                            ) : (
                              <>
                                <Copy className="w-3.5 h-3.5 text-slate-400" />
                                <span>Copy Regimen</span>
                              </>
                            )}
                          </button>

                          {/* WhatsApp Share Button */}
                          <button
                            type="button"
                            onClick={() => {
                              if (onSendConsultationToWhatsapp) {
                                onSendConsultationToWhatsapp(consultation);
                              } else {
                                const cleanNum = (consultation.whatsappNumber || whatsappNumber || '').replace(/\D/g, '');
                                const msg = encodeURIComponent(
                                  `🩺 *DERMASNAP CARE REGIMEN*\nPatient: ${consultation.patientName}\nDate: ${dateStr}\nUrgency: ${consultation.urgency || 'Routine'}\n\n${consultation.summary}`
                                );
                                window.open(`https://wa.me/${cleanNum}?text=${msg}`, '_blank');
                              }
                            }}
                            className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer shadow-xs shadow-emerald-600/20"
                            title="Send this consultation to WhatsApp"
                          >
                            <Share2 className="w-3.5 h-3.5" />
                            <span>Share to WhatsApp</span>
                          </button>
                        </div>

                        <div className="flex items-center gap-2">
                          {/* Load into Chat Button */}
                          {onSelectConsultationForChat && (
                            <button
                              type="button"
                              onClick={() => {
                                onSelectConsultationForChat(consultation);
                                onClose();
                              }}
                              className="px-3 py-1.5 rounded-xl border border-teal-300 bg-teal-50 hover:bg-teal-100 text-teal-800 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                              title="Review this case in current chat"
                            >
                              <span>Follow Up in Chat</span>
                              <ArrowRight className="w-3 h-3" />
                            </button>
                          )}

                          {/* Delete Button */}
                          <button
                            type="button"
                            onClick={() => handleDelete(consultation)}
                            disabled={deletingId === consultation.id}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                            title="Delete consultation record"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 border-t border-slate-100 bg-slate-50/80 flex items-center justify-between text-xs text-slate-500 shrink-0">
          <span className="flex items-center gap-1 text-[11px]">
            <CheckCircle2 className="w-3.5 h-3.5 text-teal-600" />
            <span>Consultations automatically sync across your visits</span>
          </span>

          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-xl text-xs font-semibold transition-colors cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
