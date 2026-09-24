import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { useState, useRef } from 'react'

function App() {
  const [isEntered, setIsEntered] = useState(false);
  const [secretPwd, setSecretPwd] = useState("");

  // Quel appareil utilisons-nous ? ('pc', 'phone', 'tv', ou null)
  const [currentDevice, setCurrentDevice] = useState(null);
  
  const [mediaActive, setMediaActive] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const localStreamRef = useRef(null);
  const pcRef = useRef(null);
  const wsRef = useRef(null);

  const RENDER_URL = "wss://webrtc-serveur.onrender.com";

  // 1. Allumer le bon média selon l'appareil cliqué
  const startMedia = async () => {
    try {
      let stream;
      
      if (currentDevice === 'phone') {
        // TÉLÉPHONE : Juste le micro
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } 
      else if (currentDevice === 'pc') {
        // PC : Vidéo bas-débit + micro
        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 320 }, height: { ideal: 240 }, frameRate: { max: 15 } },
          audio: true
        });
      } 
      else if (currentDevice === 'tv') {
        // TÉLÉVISION : Capture de l'écran + fusion avec le micro pour pouvoir parler
        const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        // On combine la vidéo de l'écran et l'audio du micro
        stream = new MediaStream([...screenStream.getTracks(), ...audioStream.getTracks()]);
      }

      localStreamRef.current = stream;
      if (localVideoRef.current && currentDevice !== 'phone') {
        localVideoRef.current.srcObject = stream;
      }
      setMediaActive(true);
      connectSignalingServer();
    } catch (error) {
      console.error(error);
      alert("Erreur lors de l'accès au média. Avez-vous refusé la permission ou annulé le partage d'écran ?");
    }
  };

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
      } else if (message.type === 'answer') {
        await pcRef.current.setRemoteDescription(new RTCSessionDescription(message.sdp));
      } else if (message.type === 'ice-candidate') {
        await pcRef.current.addIceCandidate(new RTCIceCandidate(message.candidate));
      }
    };
    wsRef.current = ws;
  };

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

  const callUser = async () => {
    if (!isConnected) return alert("En attente du serveur...");
    await setupPeerConnection();
    const offer = await pcRef.current.createOffer();
    
    // On bride à 100kbps SEULEMENT si c'est le PC. Si c'est la TV (écran), on laisse plus de débit.
    if (currentDevice === 'pc') {
      offer.sdp = offer.sdp.replace(/a=mid:video\r\n/g, 'a=mid:video\r\n' + 'b=AS:100\r\n');
    }
    
    await pcRef.current.setLocalDescription(offer);
    wsRef.current.send(JSON.stringify({ type: 'offer', sdp: offer }));
  };

  const stopCall = () => {
    if (localStreamRef.current) localStreamRef.current.getTracks().forEach(t => t.stop());
    if (pcRef.current) pcRef.current.close();
    if (wsRef.current) wsRef.current.close();
    setMediaActive(false);
    setIsConnected(false);
    setCurrentDevice(null);
  };

  if (!isEntered) {
    return (
      <div style={{ width: '100vw', height: '100vh', backgroundColor: '#d4c3b3', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ backgroundColor: 'white', padding: '40px', borderRadius: '15px', textAlign: 'center' }}>
          <h1 style={{ color: '#5c4033', marginBottom: '10px' }}>Notre Maison</h1>
          <form onSubmit={(e) => { e.preventDefault(); if (secretPwd) setIsEntered(true); }} style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
            <input type="password" placeholder="Clé secrète" value={secretPwd} onChange={(e) => setSecretPwd(e.target.value)} style={{ padding: '12px', borderRadius: '8px', border: '1px solid #ccc' }} />
            <button type="submit" style={{ padding: '12px', backgroundColor: '#5c4033', color: 'white', borderRadius: '8px', cursor: 'pointer' }}>Entrer</button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div style={{ width: '100vw', height: '100vh', backgroundColor: '#f0e6d2', position: 'relative' }}>
      
      {/* UI POUR PC ET TÉLÉ (Plein écran sombre) */}
      {(currentDevice === 'pc' || currentDevice === 'tv') && (
        <div style={{ position: 'absolute', top: 0, left: 0, width: '100vw', height: '100vh', backgroundColor: 'rgba(0, 0, 0, 0.85)', zIndex: 10, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'white' }}>
          <h2 style={{ marginBottom: '20px' }}>{currentDevice === 'pc' ? 'Appel Vidéo' : 'Partage d\'écran'}</h2>
          
          <div style={{ display: 'flex', gap: '20px', marginBottom: '30px' }}>
            <video ref={remoteVideoRef} autoPlay playsInline style={{ width: '600px', height: '400px', backgroundColor: '#111', borderRadius: '10px', border: '2px solid #555' }}></video>
            <video ref={localVideoRef} autoPlay playsInline muted style={{ width: '300px', height: '200px', backgroundColor: '#222', borderRadius: '10px', border: '2px solid #4CAF50' }}></video>
          </div>

          <div style={{ display: 'flex', gap: '15px' }}>
            {!mediaActive ? (
              <button onClick={startMedia} style={{ padding: '12px 24px', cursor: 'pointer', backgroundColor: '#2196F3', color: 'white', border: 'none', borderRadius: '5px' }}>
                {currentDevice === 'pc' ? '📷 Activer la caméra' : '🖥️ Partager mon écran'}
              </button>
            ) : (
              <button onClick={callUser} style={{ padding: '12px 24px', cursor: 'pointer', backgroundColor: '#4CAF50', color: 'white', border: 'none', borderRadius: '5px' }}>
                {isConnected ? "📞 Appeler" : "⏳ Connexion..."}
              </button>
            )}
            <button onClick={stopCall} style={{ padding: '12px 24px', cursor: 'pointer', backgroundColor: '#f44336', color: 'white', border: 'none', borderRadius: '5px' }}>✖ Raccrocher</button>
          </div>
        </div>
      )}

      {/* UI POUR TÉLÉPHONE (Petit panneau flottant pour laisser la 3D visible) */}
      {currentDevice === 'phone' && (
        <div style={{ position: 'absolute', top: '20px', right: '20px', backgroundColor: 'white', padding: '20px', borderRadius: '10px', zIndex: 10, boxShadow: '0 4px 15px rgba(0,0,0,0.2)' }}>
          <h3 style={{ margin: '0 0 15px 0', color: '#333' }}>📞 Téléphone</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {!mediaActive ? (
              <button onClick={startMedia} style={{ padding: '10px', backgroundColor: '#2196F3', color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer' }}>🎤 Activer le micro</button>
            ) : (
              <button onClick={callUser} style={{ padding: '10px', backgroundColor: '#4CAF50', color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer' }}>{isConnected ? "Sonner" : "Connexion..."}</button>
            )}
            <button onClick={stopCall} style={{ padding: '10px', backgroundColor: '#f44336', color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer' }}>Raccrocher</button>
          </div>
          {/* Audio caché pour entendre l'autre */}
          <video ref={remoteVideoRef} autoPlay playsInline style={{ display: 'none' }}></video>
        </div>
      )}

      {/* --- LE MONDE 3D --- */}
      <Canvas camera={{ position: [0, 2, 5], fov: 50 }}>
        <ambientLight intensity={0.5} />
        <directionalLight position={[5, 5, 5]} intensity={1} castShadow />
        
        {/* Sol */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.5, 0]}>
          <planeGeometry args={[10, 10]} />
          <meshStandardMaterial color="#d4c3b3" />
        </mesh>
        
        {/* Bureau */}
        <mesh position={[-1, 0, 0]}>
          <boxGeometry args={[1.5, 1, 1]} />
          <meshStandardMaterial color="#cda47b" />
        </mesh>
        
        {/* PC (Bleu) */}
        <mesh position={[-0.8, 0.75, 0]} onClick={(e) => { e.stopPropagation(); setCurrentDevice('pc'); }} onPointerEnter={() => document.body.style.cursor = 'pointer'} onPointerLeave={() => document.body.style.cursor = 'auto'}>
          <boxGeometry args={[0.5, 0.4, 0.1]} />
          <meshStandardMaterial color={currentDevice === 'pc' ? "#4CAF50" : "#4a90e2"} />
        </mesh>

        {/* TÉLÉPHONE (Petit bloc rouge sur le bureau) */}
        <mesh position={[-1.4, 0.55, 0.2]} onClick={(e) => { e.stopPropagation(); setCurrentDevice('phone'); }} onPointerEnter={() => document.body.style.cursor = 'pointer'} onPointerLeave={() => document.body.style.cursor = 'auto'}>
          <boxGeometry args={[0.15, 0.1, 0.2]} />
          <meshStandardMaterial color={currentDevice === 'phone' ? "#4CAF50" : "#e74c3c"} />
        </mesh>

        {/* Étagère */}
        <mesh position={[1.5, -0.2, 0]}>
          <boxGeometry args={[1.5, 0.6, 0.8]} />
          <meshStandardMaterial color="#5c4033" />
        </mesh>

        {/* TÉLÉVISION (Noir) sur l'étagère */}
        <mesh position={[1.5, 0.4, 0]} onClick={(e) => { e.stopPropagation(); setCurrentDevice('tv'); }} onPointerEnter={() => document.body.style.cursor = 'pointer'} onPointerLeave={() => document.body.style.cursor = 'auto'}>
          <boxGeometry args={[1.2, 0.7, 0.1]} />
          <meshStandardMaterial color={currentDevice === 'tv' ? "#4CAF50" : "#222222"} />
        </mesh>

        <OrbitControls />
      </Canvas>
    </div>
  )
}

export default App