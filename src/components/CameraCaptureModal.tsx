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
  Send,
  Smartphone,
} from 'lucide-react';

interface CameraCaptureModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCapture: (file: File, sendImmediately?: boolean) => void;
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
  const nativeCameraInputRef = useRef<HTMLInputElement | null>(null);

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

  // Check device capabilities and request stream with robust fallback
  const startCamera = async (targetFacing: 'environment' | 'user' = facingMode) => {
    stopStream();
    setErrorMessage('');
    setPermissionStatus('checking');

    // 1. Check browser mediaDevices support
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setPermissionStatus('unsupported');
      setErrorMessage(
        'Your browser or current iframe environment does not support WebRTC live streaming. You can take a photo using your device camera below.'
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
      // Non-fatal
    }

    // 3. Request camera stream with smart fallback (ideal facingMode -> basic video)
    let stream: MediaStream | null = null;

    try {
      // Attempt 1: Try with ideal facingMode and good resolution
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: targetFacing },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      });
    } catch (err1: any) {
      console.warn('Initial facingMode camera request failed, trying basic video constraint:', err1);
      try {
        // Attempt 2: Fallback for laptops and webcams without dedicated 'environment' rear camera
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: true,
        });
      } catch (err2: any) {
        console.warn('Camera access request error:', err2);
        const errName = err2?.name || err1?.name || '';

        if (errName === 'NotAllowedError' || errName === 'PermissionDeniedError') {
          setPermissionStatus('denied');
          setErrorMessage(
            'Camera permission was blocked. You can still take a picture using your device camera below or allow camera in browser settings.'
          );
        } else if (errName === 'NotFoundError' || errName === 'DevicesNotFoundError') {
          setPermissionStatus('error');
          setErrorMessage('No camera device was detected. Please connect a camera or upload an image file.');
        } else if (errName === 'NotReadableError' || errName === 'TrackStartError') {
          setPermissionStatus('error');
          setErrorMessage('Your camera is currently in use by another application. Please close other camera tabs and retry.');
        } else {
          setPermissionStatus('error');
          setErrorMessage(
            err2?.message || 'Could not initialize live camera. Please use the device camera button below.'
          );
        }
        return;
      }
    }

    if (stream) {
      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }

      // Check if torch/flashlight capability is supported
      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) {
        const capabilities: any = videoTrack.getCapabilities ? videoTrack.getCapabilities() : {};
        setFlashSupported(Boolean(capabilities.torch));
      }

      setPermissionStatus('granted');
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

  // Capture still frame from live video feed
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

    // Mirror image if using front camera
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
          stopStream();
        }
      },
      'image/jpeg',
      0.92
    );
  };

  // Handle photo from native system camera input
  const handleNativeCameraCapture = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setCapturedBlob(file);
    const previewUrl = URL.createObjectURL(file);
    setCapturedPreview(previewUrl);
    stopStream();
    e.target.value = '';
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

  // Confirm photo: either attach or send immediately
  const handleConfirmPhoto = (sendImmediately = false) => {
    if (!capturedBlob) return;
    const file = new File([capturedBlob], `skin-capture-${Date.now()}.jpg`, {
      type: 'image/jpeg',
    });
    onCapture(file, sendImmediately);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-md flex items-center justify-center p-3 sm:p-5">
      {/* Hidden native camera capture input (always works on mobile/tablets) */}
      <input
        type="file"
        ref={nativeCameraInputRef}
        accept="image/*"
        capture="environment"
        onChange={handleNativeCameraCapture}
        className="hidden"
      />

      <div className="bg-slate-900 text-white rounded-3xl max-w-xl w-full overflow-hidden shadow-2xl border border-slate-800 flex flex-col max-h-[92vh]">
        {/* Top Header */}
        <div className="px-5 py-3.5 border-b border-slate-800 flex items-center justify-between shrink-0 bg-slate-900/90">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-teal-500/20 text-teal-400 flex items-center justify-center">
              <Camera className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">Skin Camera Capture</h3>
              <p className="text-[11px] text-slate-400">Position lesion in focus box with clear lighting</p>
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
                  <div className="absolute top-0 left-0 w-6 h-6 border-t-4 border-l-4 border-teal-400 rounded-tl-xl -mt-0.5 -ml-0.5" />
                  <div className="absolute top-0 right-0 w-6 h-6 border-t-4 border-r-4 border-teal-400 rounded-tr-xl -mt-0.5 -mr-0.5" />
                  <div className="absolute bottom-0 left-0 w-6 h-6 border-b-4 border-l-4 border-teal-400 rounded-bl-xl -mb-0.5 -ml-0.5" />
                  <div className="absolute bottom-0 right-0 w-6 h-6 border-b-4 border-r-4 border-teal-400 rounded-br-xl -mb-0.5 -mr-0.5" />
                  <div className="w-2.5 h-2.5 rounded-full bg-teal-400/80 ring-4 ring-teal-400/20" />
                </div>

                <div className="mt-4 px-3.5 py-1.5 rounded-full bg-slate-900/80 backdrop-blur-md border border-slate-700/80 text-[11px] font-medium text-teal-300 flex items-center gap-1.5 shadow-lg">
                  <Sparkles className="w-3.5 h-3.5 text-teal-400" />
                  <span>Align skin area • Keep phone 4–6 inches away</span>
                </div>
              </div>

              {/* Viewfinder Controls (Flip, Torch, Native Camera) */}
              <div className="absolute top-4 right-4 flex flex-col gap-2">
                {hasMultipleCameras && (
                  <button
                    type="button"
                    onClick={handleSwitchCamera}
                    className="p-2.5 rounded-full bg-slate-900/80 backdrop-blur-md border border-slate-700 hover:bg-slate-800 text-white transition-all shadow-md cursor-pointer"
                    title={`Switch camera mode`}
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

                {/* Direct Native Phone Camera Trigger */}
                <button
                  type="button"
                  onClick={() => nativeCameraInputRef.current?.click()}
                  className="p-2.5 rounded-full bg-slate-900/80 backdrop-blur-md border border-slate-700 hover:bg-slate-800 text-teal-300 transition-all shadow-md cursor-pointer"
                  title="Open phone camera app directly"
                >
                  <Smartphone className="w-4 h-4" />
                </button>
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
                <span>Photo Captured Ready</span>
              </div>
            </div>
          )}

          {/* Permission Checking / Requesting State */}
          {permissionStatus === 'checking' && !capturedPreview && (
            <div className="text-center px-6 py-8 space-y-4">
              <div className="w-12 h-12 rounded-2xl bg-teal-500/10 border border-teal-500/30 text-teal-400 flex items-center justify-center mx-auto animate-pulse">
                <Camera className="w-6 h-6" />
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-200">Connecting Camera...</p>
                <p className="text-xs text-slate-400 max-w-sm mx-auto mt-1">
                  Please tap <strong className="text-teal-300">"Allow"</strong> if prompted by your browser.
                </p>
              </div>

              {/* Instant option to open native device camera immediately */}
              <div className="pt-2">
                <button
                  type="button"
                  onClick={() => nativeCameraInputRef.current?.click()}
                  className="px-4 py-2 rounded-xl bg-teal-600 hover:bg-teal-700 text-white text-xs font-semibold inline-flex items-center gap-2 cursor-pointer shadow-md"
                >
                  <Smartphone className="w-4 h-4" />
                  <span>Open Device Camera Directly</span>
                </button>
              </div>
            </div>
          )}

          {/* Permission Denied or Restricted State */}
          {permissionStatus === 'denied' && (
            <div className="text-center px-6 py-8 space-y-4 max-w-md mx-auto">
              <div className="w-12 h-12 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-400 flex items-center justify-center mx-auto">
                <Lock className="w-6 h-6" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-slate-200">Browser Camera Permission</h4>
                <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">
                  WebRTC stream was blocked by browser permissions, but you can take a picture right now using your phone's native camera!
                </p>
              </div>

              {/* Primary 1-Click Action: Open Phone Camera Directly */}
              <div className="bg-teal-950/60 border border-teal-700/50 rounded-2xl p-4 text-center space-y-2">
                <p className="text-xs font-bold text-teal-200">
                  📸 Quick Camera Action:
                </p>
                <p className="text-[11px] text-teal-300/80">
                  Tap below to launch your phone's system camera directly without permission errors:
                </p>
                <button
                  type="button"
                  onClick={() => nativeCameraInputRef.current?.click()}
                  className="w-full py-2.5 bg-teal-500 hover:bg-teal-400 text-slate-950 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all cursor-pointer shadow-md shadow-teal-500/20"
                >
                  <Smartphone className="w-4 h-4" />
                  <span>Launch Phone Camera App</span>
                </button>
              </div>

              <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => startCamera(facingMode)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer border border-slate-700"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Retry WebRTC</span>
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
                  <span>Upload File</span>
                </button>
              </div>
            </div>
          )}

          {/* Unsupported or Hardware Error State */}
          {(permissionStatus === 'unsupported' || permissionStatus === 'error') && (
            <div className="text-center px-6 py-8 space-y-4 max-w-md mx-auto">
              <div className="w-12 h-12 rounded-2xl bg-teal-500/10 border border-teal-500/30 text-teal-400 flex items-center justify-center mx-auto">
                <Smartphone className="w-6 h-6" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-slate-200">Take Skin Photo</h4>
                <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">{errorMessage}</p>
              </div>

              {/* Instant device camera button */}
              <button
                type="button"
                onClick={() => nativeCameraInputRef.current?.click()}
                className="w-full py-3 bg-teal-600 hover:bg-teal-500 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all cursor-pointer shadow-lg shadow-teal-600/30"
              >
                <Camera className="w-4 h-4" />
                <span>Open Device Camera Now</span>
              </button>

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
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-xl text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>Choose from Gallery / Files</span>
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
                onClick={() => nativeCameraInputRef.current?.click()}
                className="px-3 py-2 text-xs font-medium text-teal-400 hover:text-teal-300 flex items-center gap-1.5 transition-colors cursor-pointer"
                title="Launch system camera"
              >
                <Smartphone className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Device Camera</span>
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
                onClick={() => {
                  onClose();
                  onFallbackToFile();
                }}
                className="px-3 py-2 text-xs font-medium text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
              >
                <Upload className="w-3.5 h-3.5" />
                <span className="hidden sm:inline ml-1">Upload</span>
              </button>
            </div>
          )}

          {/* Captured Review Actions */}
          {capturedPreview && (
            <div className="flex flex-col sm:flex-row items-center justify-between gap-2.5">
              <button
                type="button"
                onClick={handleRetake}
                className="w-full sm:w-auto py-2.5 px-4 rounded-xl border border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Retake</span>
              </button>

              <div className="flex items-center gap-2 w-full sm:w-auto">
                <button
                  type="button"
                  onClick={() => handleConfirmPhoto(false)}
                  className="flex-1 sm:flex-initial py-2.5 px-4 rounded-xl border border-teal-500/40 bg-teal-950/60 hover:bg-teal-900/80 text-teal-300 text-xs font-semibold transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                  title="Attach photo to message bar"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>Attach Photo</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleConfirmPhoto(true)}
                  className="flex-1 sm:flex-initial py-2.5 px-5 rounded-xl bg-teal-600 hover:bg-teal-500 text-white text-xs font-bold transition-all shadow-md shadow-teal-600/30 flex items-center justify-center gap-2 cursor-pointer"
                  title="Send immediately for AI dermatology triage"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>Send for Triage</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
