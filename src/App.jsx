import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { useState, useRef } from 'react'

function App() {
  const [isInCall, setIsInCall] = useState(false);
  const [cameraActive, setCameraActive] = useState(false);
  const [isConnected, setIsConnected] = useState(false); // Savoir si on est co au serveur
  
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  
  // Les références pour le réseau
  const localStreamRef = useRef(null);
  const pcRef = useRef(null);
  const wsRef = useRef(null);

  // IDENTIFIANTS
  const RENDER_URL = "wss://webrtc-serveur.onrender.com"; 
  const PASSWORD = "VOTRE_MOT_DE_PASSE";

  // 1. Allumer la caméra (Optimisé Bas-Débit)
  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 320 }, height: { ideal: 240 }, frameRate: { max: 15 } },
        audio: true
      });
      localStreamRef.current = stream;
      if (localVideoRef.current) localVideoRef.current.srcObject = stream;
      setCameraActive(true);
      
      // Une fois la caméra allumée, on se connecte au serveur Render
      connectSignalingServer();
    } catch (error) {
      alert("Erreur caméra.");
    }
  };

  // 2. Connexion au serveur WebSocket
  const connectSignalingServer = () => {
    // On demande le mot de passe en direct, il n'est sauvegardé nulle part !
    const secretPwd = prompt("Veuillez entrer le mot de passe secret de Canal Lise :");
    if (!secretPwd) {
      return alert("Connexion annulée : Mot de passe requis.");
    }

    const ws = new WebSocket(`${RENDER_URL}/?token=${secretPwd}`);
    
    ws.onopen = () => setIsConnected(true);
    ws.onclose = () => setIsConnected(false);

    ws.onmessage = async (event) => {
      const message = JSON.parse(event.data);

      if (message.type === 'offer') {
        await setupPeerConnection();
        await pcRef.current.setRemoteDescription(new RTCSessionDescription(message.sdp));
        const answer = await pcRef.current.createAnswer();
        await pcRef.current.setLocalDescription(answer);
        ws.send(JSON.stringify({ type: 'answer', sdp: answer }));
      } 
      else if (message.type === 'answer') {
        await pcRef.current.setRemoteDescription(new RTCSessionDescription(message.sdp));
      } 
      else if (message.type === 'ice-candidate') {
        await pcRef.current.addIceCandidate(new RTCIceCandidate(message.candidate));
      }
    };
    wsRef.current = ws;
  };

  // 3. Préparer le tunnel P2P
  const setupPeerConnection = async () => {
    const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });

    // On ajoute notre flux bas-débit
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => pc.addTrack(track, localStreamRef.current));
    }

    // Quand on reçoit la vidéo de l'autre
    pc.ontrack = (event) => {
      if (remoteVideoRef.current && !remoteVideoRef.current.srcObject) {
        remoteVideoRef.current.srcObject = event.streams[0];
      }
    };

    pc.onicecandidate = (event) => {
      if (event.candidate && wsRef.current) {
        wsRef.current.send(JSON.stringify({ type: 'ice-candidate', candidate: event.candidate }));
      }
    };
    pcRef.current = pc;
  };

  // 4. Lancer l'appel (avec le bridage SDP à 100kbps)
  const callUser = async () => {
    if (!isConnected) return alert("En attente du serveur...");
    
    await setupPeerConnection();
    const offer = await pcRef.current.createOffer();
    
    // Forcer la limite à 100 kbps pour la vidéo
    offer.sdp = offer.sdp.replace(/a=mid:video\r\n/g, 'a=mid:video\r\n' + 'b=AS:100\r\n');
    
    await pcRef.current.setLocalDescription(offer);
    wsRef.current.send(JSON.stringify({ type: 'offer', sdp: offer }));
  };

  // 5. Raccrocher et tout nettoyer
  const stopCall = () => {
    if (localStreamRef.current) localStreamRef.current.getTracks().forEach(t => t.stop());
    if (pcRef.current) pcRef.current.close();
    if (wsRef.current) wsRef.current.close();
    setCameraActive(false);
    setIsConnected(false);
    setIsInCall(false);
  };

  const clickPC = (event) => {
    event.stopPropagation();
    setIsInCall(true);
  };

  return (
    <div style={{ width: '100vw', height: '100vh', backgroundColor: '#f0e6d2', position: 'relative' }}>
      
      {/* --- INTERFACE VIDÉO --- */}
      {isInCall && (
        <div style={{
          position: 'absolute', top: 0, left: 0, width: '100vw', height: '100vh',
          backgroundColor: 'rgba(0, 0, 0, 0.85)', zIndex: 10,
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'white'
        }}>
          <h2 style={{ marginBottom: '20px' }}>Canal Lise - Connexion Sécurisée</h2>
          
          <div style={{ display: 'flex', gap: '20px', marginBottom: '30px' }}>
            <video ref={remoteVideoRef} autoPlay playsInline style={{ width: '600px', height: '400px', backgroundColor: '#111', borderRadius: '10px', border: '2px solid #555' }}></video>
            <video ref={localVideoRef} autoPlay playsInline muted style={{ width: '300px', height: '200px', backgroundColor: '#222', borderRadius: '10px', border: '2px solid #4CAF50' }}></video>
          </div>

          <div style={{ display: 'flex', gap: '15px' }}>
            {!cameraActive ? (
              <button onClick={startCamera} style={{ padding: '12px 24px', cursor: 'pointer', backgroundColor: '#2196F3', color: 'white', border: 'none', borderRadius: '5px' }}>
                📷 Activer la caméra
              </button>
            ) : (
              <button onClick={callUser} style={{ padding: '12px 24px', cursor: 'pointer', backgroundColor: '#4CAF50', color: 'white', border: 'none', borderRadius: '5px' }}>
                {isConnected ? "📞 Appeler Lise" : "⏳ Connexion au serveur..."}
              </button>
            )}
            <button onClick={stopCall} style={{ padding: '12px 24px', cursor: 'pointer', backgroundColor: '#f44336', color: 'white', border: 'none', borderRadius: '5px' }}>
              ✖ Retourner dans la chambre
            </button>
          </div>
        </div>
      )}

      {/* --- MONDE 3D --- */}
      <Canvas camera={{ position: [0, 2, 5], fov: 50 }}>
        <ambientLight intensity={0.5} />
        <directionalLight position={[5, 5, 5]} intensity={1} castShadow />
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.5, 0]}>
          <planeGeometry args={[10, 10]} />
          <meshStandardMaterial color="#d4c3b3" />
        </mesh>
        <mesh position={[-1, 0, 0]}>
          <boxGeometry args={[1.5, 1, 1]} />
          <meshStandardMaterial color="#cda47b" />
        </mesh>
        <mesh position={[-1, 0.75, 0]} onClick={clickPC} onPointerEnter={() => document.body.style.cursor = 'pointer'} onPointerLeave={() => document.body.style.cursor = 'auto'}>
          <boxGeometry args={[0.5, 0.4, 0.1]} />
          <meshStandardMaterial color={isInCall ? "#4CAF50" : "#4a90e2"} />
        </mesh>
        <OrbitControls />
      </Canvas>
    </div>
  )
}

export default App