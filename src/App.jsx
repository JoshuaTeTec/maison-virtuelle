import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { useState, useRef } from 'react'

function App() {
  // --- ÉTATS DE SÉCURITÉ ---
  const [isEntered, setIsEntered] = useState(false); // Est-on dans la maison ?
  const [secretPwd, setSecretPwd] = useState("");    // Stocke le mot de passe en mémoire

  // --- ÉTATS DU JEU ---
  const [isInCall, setIsInCall] = useState(false);
  const [cameraActive, setCameraActive] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const localStreamRef = useRef(null);
  const pcRef = useRef(null);
  const wsRef = useRef(null);

  const RENDER_URL = "wss://webrtc-serveur.onrender.com"; // Laissez "wss://"

  // 1. Allumer la caméra
  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 320 }, height: { ideal: 240 }, frameRate: { max: 15 } },
        audio: true
      });
      localStreamRef.current = stream;
      if (localVideoRef.current) localVideoRef.current.srcObject = stream;
      setCameraActive(true);
      connectSignalingServer();
    } catch (error) {
      alert("Erreur caméra.");
    }
  };

  // 2. Connexion au serveur (utilise maintenant le mot de passe en mémoire !)
  const connectSignalingServer = () => {
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
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => pc.addTrack(track, localStreamRef.current));
    }
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

  // 4. Lancer l'appel (100 kbps)
  const callUser = async () => {
    if (!isConnected) return alert("En attente du serveur...");
    await setupPeerConnection();
    const offer = await pcRef.current.createOffer();
    offer.sdp = offer.sdp.replace(/a=mid:video\r\n/g, 'a=mid:video\r\n' + 'b=AS:100\r\n');
    await pcRef.current.setLocalDescription(offer);
    wsRef.current.send(JSON.stringify({ type: 'offer', sdp: offer }));
  };

  // 5. Raccrocher
  const stopCall = () => {
    if (localStreamRef.current) localStreamRef.current.getTracks().forEach(t => t.stop());
    if (pcRef.current) pcRef.current.close();
    if (wsRef.current) wsRef.current.close();
    setCameraActive(false);
    setIsConnected(false);
    setIsInCall(false);
  };

  // Gestion du formulaire d'entrée
  const handleEntry = (e) => {
    e.preventDefault();
    if (secretPwd.trim() !== "") {
      setIsEntered(true); // Déverrouille la maison 3D
    }
  };

  // --- ÉCRAN D'ACCUEIL (PORTE D'ENTRÉE) ---
  if (!isEntered) {
    return (
      <div style={{ width: '100vw', height: '100vh', backgroundColor: '#d4c3b3', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', fontFamily: 'sans-serif' }}>
        <div style={{ backgroundColor: 'white', padding: '40px', borderRadius: '15px', boxShadow: '0 4px 15px rgba(0,0,0,0.1)', textAlign: 'center' }}>
          <h1 style={{ color: '#5c4033', marginBottom: '10px' }}>Notre Maison</h1>
          <p style={{ color: '#888', marginBottom: '30px' }}>Entrez la clé pour accéder au salon.</p>
          <form onSubmit={handleEntry} style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
            <input 
              type="password" 
              placeholder="Clé secrète"
              value={secretPwd}
              onChange={(e) => setSecretPwd(e.target.value)}
              style={{ padding: '12px', fontSize: '16px', borderRadius: '8px', border: '1px solid #ccc', outline: 'none' }}
            />
            <button type="submit" style={{ padding: '12px', fontSize: '16px', backgroundColor: '#5c4033', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold' }}>
              Entrer
            </button>
          </form>
        </div>
      </div>
    );
  }

  // --- LE MONDE 3D (Accessible uniquement si isEntered est vrai) ---
  return (
    <div style={{ width: '100vw', height: '100vh', backgroundColor: '#f0e6d2', position: 'relative' }}>
      
      {/* Interface d'appel */}
      {isInCall && (
        <div style={{ position: 'absolute', top: 0, left: 0, width: '100vw', height: '100vh', backgroundColor: 'rgba(0, 0, 0, 0.85)', zIndex: 10, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'white' }}>
          <h2 style={{ marginBottom: '20px' }}>Canal Lise</h2>
          <div style={{ display: 'flex', gap: '20px', marginBottom: '30px' }}>
            <video ref={remoteVideoRef} autoPlay playsInline style={{ width: '600px', height: '400px', backgroundColor: '#111', borderRadius: '10px', border: '2px solid #555' }}></video>
            <video ref={localVideoRef} autoPlay playsInline muted style={{ width: '300px', height: '200px', backgroundColor: '#222', borderRadius: '10px', border: '2px solid #4CAF50' }}></video>
          </div>
          <div style={{ display: 'flex', gap: '15px' }}>
            {!cameraActive ? (
              <button onClick={startCamera} style={{ padding: '12px 24px', cursor: 'pointer', backgroundColor: '#2196F3', color: 'white', border: 'none', borderRadius: '5px' }}>📷 Activer la caméra</button>
            ) : (
              <button onClick={callUser} style={{ padding: '12px 24px', cursor: 'pointer', backgroundColor: '#4CAF50', color: 'white', border: 'none', borderRadius: '5px' }}>{isConnected ? "📞 Appeler Lise" : "⏳ Connexion au serveur..."}</button>
            )}
            <button onClick={stopCall} style={{ padding: '12px 24px', cursor: 'pointer', backgroundColor: '#f44336', color: 'white', border: 'none', borderRadius: '5px' }}>✖ Retourner dans la chambre</button>
          </div>
        </div>
      )}

      {/* Rendu 3D */}
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
        <mesh position={[-1, 0.75, 0]} onClick={(e) => { e.stopPropagation(); setIsInCall(true); }} onPointerEnter={() => document.body.style.cursor = 'pointer'} onPointerLeave={() => document.body.style.cursor = 'auto'}>
          <boxGeometry args={[0.5, 0.4, 0.1]} />
          <meshStandardMaterial color={isInCall ? "#4CAF50" : "#4a90e2"} />
        </mesh>
        <OrbitControls />
      </Canvas>
    </div>
  )
}

export default App