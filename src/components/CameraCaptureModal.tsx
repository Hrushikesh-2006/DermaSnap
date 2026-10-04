import React, { useState, useEffect, useRef } from 'react';
import {
  Camera,
  RefreshCw,
  X,
  AlertCircle,
  Check,
  SwitchCamera,
  Upload,
  Lock,
  Sparkles,
  Zap,
} from 'lucide-react';

interface CameraCaptureModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCapture: (file: File) => void;
  onFallbackToFile: () => void;
}

type PermissionStatus = 'checking' | 'prompt' | 'granted' | 'denied' | 'unsupported' | 'error';

export const CameraCaptureModal: React.FC<CameraCaptureModalProps> = ({
  isOpen,
  onClose,
  onCapture,
  onFallbackToFile,
}) => {
  const [permissionStatus, setPermissionStatus] = useState<PermissionStatus>('checking');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [capturedBlob, setCapturedBlob] = useState<Blob | null>(null);
  const [capturedPreview, setCapturedPreview] = useState<string | null>(null);
  const [hasMultipleCameras, setHasMultipleCameras] = useState<boolean>(false);
  const [isCapturing, setIsCapturing] = useState<boolean>(false);
  const [flashSupported, setFlashSupported] = useState<boolean>(false);
  const [torchOn, setTorchOn] = useState<boolean>(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Stop current active media stream tracks
  const stopStream = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => {
        track.stop();
      });
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  };

  // Check device capabilities and request stream
  const startCamera = async (targetFacing: 'environment' | 'user' = facingMode) => {
    stopStream();
    setErrorMessage('');
    setPermissionStatus('checking');

    // 1. Check browser mediaDevices support
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setPermissionStatus('unsupported');
      setErrorMessage(
        'Your browser or environment does not support direct camera capture. Please use the file upload option.'
      );
      return;
    }

    // 2. Enumerate video devices to see if flip is possible
    try {
      if (navigator.mediaDevices.enumerateDevices) {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoInputs = devices.filter((d) => d.kind === 'videoinput');
        setHasMultipleCameras(videoInputs.length > 1);
      }
    } catch {
      // Non-fatal device enumeration error
    }

    // 3. Request camera stream
    try {
      const constraints: MediaStreamConstraints = {
        audio: false,
        video: {
          facingMode: targetFacing,
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }

      // Check if torch/flashlight capability is supported
      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) {
        const capabilities: any = videoTrack.getCapabilities ? videoTrack.getCapabilities() : {};
        if (capabilities.torch) {
          setFlashSupported(true);
        } else {
          setFlashSupported(false);
        }
      }

      setPermissionStatus('granted');
    } catch (err: any) {
      console.warn('Camera access request error:', err);
      const errName = err?.name || '';

      if (errName === 'NotAllowedError' || errName === 'PermissionDeniedError') {
        setPermissionStatus('denied');
        setErrorMessage(
          'Camera permission was declined or blocked by your browser. Please allow camera access in your browser settings to take photos directly.'
        );
      } else if (errName === 'NotFoundError' || errName === 'DevicesNotFoundError') {
        setPermissionStatus('error');
        setErrorMessage('No camera device was found on this system. Please attach a camera or upload an image file.');
      } else if (errName === 'NotReadableError' || errName === 'TrackStartError') {
        setPermissionStatus('error');
        setErrorMessage('Your camera is currently in use by another application or tab. Please close other camera apps and retry.');
      } else {
        setPermissionStatus('error');
        setErrorMessage(
          err?.message || 'Could not initialize camera stream. Please check permissions or choose an image file.'
        );
      }
    }
  };

  // Handle open / close lifecycle
  useEffect(() => {
    if (isOpen) {
      setCapturedBlob(null);
      setCapturedPreview(null);
      startCamera(facingMode);
    } else {
      stopStream();
      setTorchOn(false);
    }

    return () => {
      stopStream();
    };
  }, [isOpen, facingMode]);

  // Toggle Torch/Flashlight
  const toggleTorch = async () => {
    if (!streamRef.current) return;
    const videoTrack = streamRef.current.getVideoTracks()[0];
    if (videoTrack) {
      try {
        const nextState = !torchOn;
        await (videoTrack as any).applyConstraints({
          advanced: [{ torch: nextState }],
        });
        setTorchOn(nextState);
      } catch (e) {
        console.warn('Torch toggle failed:', e);
      }
    }
  };

  // Flip Camera between Environment (back) and User (selfie)
  const handleSwitchCamera = () => {
    const nextMode = facingMode === 'environment' ? 'user' : 'environment';
    setFacingMode(nextMode);
  };

  // Capture still image frame from video feed
  const takeSnapshot = () => {
    if (!videoRef.current || isCapturing) return;

    setIsCapturing(true);
    const video = videoRef.current;
    const width = video.videoWidth || 1280;
    const height = video.videoHeight || 720;

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      setIsCapturing(false);
      return;
    }

    // Mirror image if using front selfie camera
    if (facingMode === 'user') {
      ctx.translate(width, 0);
      ctx.scale(-1, 1);
    }

    ctx.drawImage(video, 0, 0, width, height);

    canvas.toBlob(
      (blob) => {
        setIsCapturing(false);
        if (blob) {
          setCapturedBlob(blob);
          const previewUrl = URL.createObjectURL(blob);
          setCapturedPreview(previewUrl);
          // Pause stream while reviewing
          stopStream();
        }
      },
      'image/jpeg',
      0.92
    );
  };

  // Retake photo
  const handleRetake = () => {
    if (capturedPreview) {
      URL.revokeObjectURL(capturedPreview);
    }
    setCapturedBlob(null);
    setCapturedPreview(null);
    startCamera(facingMode);
  };

  // Confirm and submit captured photo
  const handleConfirmPhoto = () => {
    if (!capturedBlob) return;
    const file = new File([capturedBlob], `skin-capture-${Date.now()}.jpg`, {
      type: 'image/jpeg',
    });
    onCapture(file);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-3 sm:p-5">
      <div className="bg-slate-900 text-white rounded-3xl max-w-xl w-full overflow-hidden shadow-2xl border border-slate-800 flex flex-col max-h-[92vh]">
        {/* Top Header */}
        <div className="px-5 py-3.5 border-b border-slate-800 flex items-center justify-between shrink-0 bg-slate-900/90">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-teal-500/20 text-teal-400 flex items-center justify-center">
              <Camera className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">Direct Skin Photo Capture</h3>
              <p className="text-[11px] text-slate-400">Position lesion in focus box with good lighting</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 hover:bg-slate-800 rounded-xl text-slate-400 hover:text-white transition-colors cursor-pointer"
            title="Close camera"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Camera Viewport / Review Area */}
        <div className="relative flex-1 bg-black min-h-[340px] sm:min-h-[420px] flex items-center justify-center overflow-hidden">
          {/* Active Live Video Stream */}
          {permissionStatus === 'granted' && !capturedPreview && (
            <>
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className={`w-full h-full object-cover ${
                  facingMode === 'user' ? 'scale-x-[-1]' : ''
                }`}
              />

              {/* Medical Framing Alignment Reticle */}
              <div className="absolute inset-0 pointer-events-none flex flex-col items-center justify-center p-6">
                <div className="relative w-64 h-64 sm:w-76 sm:h-76 border-2 border-teal-400/60 rounded-3xl border-dashed shadow-[0_0_0_9999px_rgba(0,0,0,0.4)] flex items-center justify-center">
                  {/* Reticle corner markers */}
                  <div className="absolute top-0 left-0 w-6 h-6 border-t-4 border-l-4 border-teal-400 rounded-tl-xl -mt-0.5 -ml-0.5" />
                  <div className="absolute top-0 right-0 w-6 h-6 border-t-4 border-r-4 border-teal-400 rounded-tr-xl -mt-0.5 -mr-0.5" />
                  <div className="absolute bottom-0 left-0 w-6 h-6 border-b-4 border-l-4 border-teal-400 rounded-bl-xl -mb-0.5 -ml-0.5" />
                  <div className="absolute bottom-0 right-0 w-6 h-6 border-b-4 border-r-4 border-teal-400 rounded-br-xl -mb-0.5 -mr-0.5" />

                  {/* Reticle center point */}
                  <div className="w-2.5 h-2.5 rounded-full bg-teal-400/80 ring-4 ring-teal-400/20" />
                </div>

                <div className="mt-4 px-3.5 py-1.5 rounded-full bg-slate-900/80 backdrop-blur-md border border-slate-700/80 text-[11px] font-medium text-teal-300 flex items-center gap-1.5 shadow-lg">
                  <Sparkles className="w-3.5 h-3.5 text-teal-400" />
                  <span>Align skin area • Keep phone 4–6 inches away</span>
                </div>
              </div>

              {/* Viewfinder Controls (Flip, Torch) */}
              <div className="absolute top-4 right-4 flex flex-col gap-2">
                {hasMultipleCameras && (
                  <button
                    type="button"
                    onClick={handleSwitchCamera}
                    className="p-2.5 rounded-full bg-slate-900/80 backdrop-blur-md border border-slate-700 hover:bg-slate-800 text-white transition-all shadow-md cursor-pointer"
                    title={`Switch to ${facingMode === 'environment' ? 'front' : 'rear'} camera`}
                  >
                    <SwitchCamera className="w-4 h-4 text-teal-300" />
                  </button>
                )}

                {flashSupported && (
                  <button
                    type="button"
                    onClick={toggleTorch}
                    className={`p-2.5 rounded-full backdrop-blur-md border transition-all shadow-md cursor-pointer ${
                      torchOn
                        ? 'bg-amber-500 text-slate-950 border-amber-400'
                        : 'bg-slate-900/80 text-white border-slate-700 hover:bg-slate-800'
                    }`}
                    title={torchOn ? 'Turn light off' : 'Turn light on'}
                  >
                    <Zap className="w-4 h-4" />
                  </button>
                )}
              </div>
            </>
          )}

          {/* Captured Review Preview */}
          {capturedPreview && (
            <div className="relative w-full h-full flex items-center justify-center bg-black">
              <img
                src={capturedPreview}
                alt="Captured skin lesion"
                className="w-full h-full object-contain"
              />
              <div className="absolute top-3 left-3 bg-teal-500/90 text-white text-[11px] font-semibold px-2.5 py-1 rounded-full shadow-md backdrop-blur-xs flex items-center gap-1">
                <Check className="w-3 h-3 stroke-[3]" />
                <span>Photo Captured</span>
              </div>
            </div>
          )}

          {/* Permission Checking / Requesting State */}
          {permissionStatus === 'checking' && !capturedPreview && (
            <div className="text-center px-6 py-8 space-y-3">
              <div className="w-12 h-12 rounded-2xl bg-teal-500/10 border border-teal-500/30 text-teal-400 flex items-center justify-center mx-auto animate-pulse">
                <Camera className="w-6 h-6" />
              </div>
              <p className="text-sm font-semibold text-slate-200">Requesting Camera Access...</p>
              <p className="text-xs text-slate-400 max-w-sm mx-auto">
                Please click <strong className="text-teal-300">"Allow"</strong> when prompted by your browser to use your camera for skin triage.
              </p>
            </div>
          )}

          {/* Permission Denied State */}
          {permissionStatus === 'denied' && (
            <div className="text-center px-6 py-8 space-y-4 max-w-md mx-auto">
              <div className="w-12 h-12 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-400 flex items-center justify-center mx-auto">
                <Lock className="w-6 h-6" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-slate-200">Camera Access Blocked</h4>
                <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">
                  {errorMessage || 'Camera permission was declined in your browser settings.'}
                </p>
              </div>

              {/* Troubleshooting Instructions */}
              <div className="bg-slate-800/80 border border-slate-700 rounded-2xl p-3.5 text-left text-xs space-y-1.5 text-slate-300">
                <p className="font-semibold text-teal-300 text-[11px] uppercase tracking-wider">
                  How to enable camera:
                </p>
                <ol className="list-decimal pl-4 space-y-1 text-[11px] text-slate-300">
                  <li>Click the <strong>Lock (🔒)</strong> or tune icon in your browser address bar.</li>
                  <li>Toggle <strong>Camera</strong> permission to <strong>Allow</strong>.</li>
                  <li>Click <strong>Retry Camera</strong> below.</li>
                </ol>
              </div>

              <div className="flex flex-wrap items-center justify-center gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => startCamera(facingMode)}
                  className="px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Retry Camera</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onFallbackToFile();
                  }}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-xl text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>Upload File Instead</span>
                </button>
              </div>
            </div>
          )}

          {/* Unsupported or Hardware Error State */}
          {(permissionStatus === 'unsupported' || permissionStatus === 'error') && (
            <div className="text-center px-6 py-8 space-y-4 max-w-md mx-auto">
              <div className="w-12 h-12 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-400 flex items-center justify-center mx-auto">
                <AlertCircle className="w-6 h-6" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-slate-200">Camera Unavailable</h4>
                <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">{errorMessage}</p>
              </div>

              <div className="flex flex-wrap items-center justify-center gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => startCamera(facingMode)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer border border-slate-700"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Try Again</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onFallbackToFile();
                  }}
                  className="px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>Upload Photo from Files</span>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Bottom Action Footer */}
        <div className="px-5 py-4 border-t border-slate-800 bg-slate-900/90 shrink-0">
          {!capturedPreview && permissionStatus === 'granted' && (
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onFallbackToFile();
                }}
                className="px-3.5 py-2 text-xs font-medium text-slate-400 hover:text-slate-200 flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <Upload className="w-3.5 h-3.5" />
                <span>Upload from files</span>
              </button>

              {/* Shutter Button */}
              <button
                type="button"
                onClick={takeSnapshot}
                disabled={isCapturing}
                className="group relative w-16 h-16 rounded-full border-4 border-white flex items-center justify-center transition-all hover:scale-105 active:scale-95 cursor-pointer shadow-xl shadow-teal-500/20"
                title="Capture photo"
              >
                <div className="w-11 h-11 rounded-full bg-teal-500 group-hover:bg-teal-400 transition-colors" />
              </button>

              <button
                type="button"
                onClick={onClose}
                className="px-3.5 py-2 text-xs font-medium text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
              >
                Cancel
              </button>
            </div>
          )}

          {/* Captured Review Actions */}
          {capturedPreview && (
            <div className="flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={handleRetake}
                className="flex-1 py-2.5 px-4 rounded-xl border border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition-colors flex items-center justify-center gap-2 cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Retake</span>
              </button>

              <button
                type="button"
                onClick={handleConfirmPhoto}
                className="flex-1 py-2.5 px-4 rounded-xl bg-teal-600 hover:bg-teal-700 text-white text-xs font-bold transition-all shadow-md shadow-teal-600/30 flex items-center justify-center gap-2 cursor-pointer"
              >
                <Check className="w-4 h-4 stroke-[3]" />
                <span>Use This Photo</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
