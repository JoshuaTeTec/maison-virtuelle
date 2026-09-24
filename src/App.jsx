import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { useState, useRef, useEffect } from 'react'

// --- VOS CONFIGURATIONS ---
const RENDER_URL = "wss://webrtc-serveur.onrender.com";
// Remplacez le lien ci-dessous par le lien d'intégration (Embed) de votre playlist commune
const SPOTIFY_PLAYLIST_URL = "https://open.spotify.com/embed/playlist/37i9dQZF1DXcBWIGoYBM5M?utm_source=generator&theme=0";

function App() {
  // SÉCURITÉ
  const [isEntered, setIsEntered] = useState(false);
  const [secretPwd, setSecretPwd] = useState("");

  // ÉTATS DU JEU
  const [currentDevice, setCurrentDevice] = useState(null);
  const [mediaActive, setMediaActive] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [incomingOffer, setIncomingOffer] = useState(null); 
  const [blink, setBlink] = useState(false); 

  // RÉFÉRENCES WEBRTC
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const localStreamRef = useRef(null);
  const pcRef = useRef(null);
  const wsRef = useRef(null);
  
  const ringAudio = useRef(new Audio('https://actions.google.com/sounds/v1/alarms/phone_ringing.ogg'));

  // ==========================================
  // 1. SÉCURITÉ STRICTE (TEST DU MOT DE PASSE)
  // ==========================================
  const handleLogin = (e) => {
    e.preventDefault();
    if (!secretPwd) return;

    const testWs = new WebSocket(`${RENDER_URL}/?token=${secretPwd}`);
    let opened = false;
    
    testWs.onopen = () => {
      opened = true;
      testWs.close(); 
      setIsEntered(true); 
    };

    testWs.onclose = () => {
      if (!opened) {
        alert("Accès refusé : Clé secrète incorrecte ou serveur hors ligne.");
      }
    };
  };

  // ==========================================
  // 2. CONNEXION PERMANENTE
  // ==========================================
  useEffect(() => {
    if (isEntered && secretPwd) {
      const ws = new WebSocket(`${RENDER_URL}/?token=${secretPwd}`);
      ws.onopen = () => setIsConnected(true);
      ws.onclose = () => setIsConnected(false);

      ws.onmessage = async (event) => {
        const message = JSON.parse(event.data);
        if (message.type === 'offer') {
          setIncomingOffer({ sdp: message.sdp, device: message.device || 'pc' });
        } else if (message.type === 'answer') {
          if (pcRef.current) await pcRef.current.setRemoteDescription(new RTCSessionDescription(message.sdp));
        } else if (message.type === 'ice-candidate') {
          if (pcRef.current) await pcRef.current.addIceCandidate(new RTCIceCandidate(message.candidate));
        }
      };
      wsRef.current = ws;
      return () => ws.close();
    }
  }, [isEntered, secretPwd]);

  useEffect(() => {
    ringAudio.current.loop = true;
    if (incomingOffer) {
      ringAudio.current.play().catch(e => console.log("Son bloqué", e));
      const interval = setInterval(() => setBlink(b => !b), 400);
      return () => {
        clearInterval(interval);
        ringAudio.current.pause();
        ringAudio.current.currentTime = 0;
        setBlink(false);
      };
    }
  }, [incomingOffer]);


  // ==========================================
  // 3. FONCTIONS WEBRTC
  // ==========================================
  const startMedia = async () => {
    try {
      let stream;
      
      // LOGIQUE DES APPAREILS
      if (currentDevice === 'tv' && !incomingOffer) {
        // 1. CELUI QUI APPELLE AVEC LA TÉLÉ (Partage d'écran + Micro)
        const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream = new MediaStream([...screenStream.getTracks(), ...audioStream.getTracks()]);
      } 
      else if (currentDevice === 'pc' && !incomingOffer) {
        // 2. CELUI QUI APPELLE AVEC LE PC (Caméra bas-débit + Micro)
        stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 320 }, height: { ideal: 240 }, frameRate: { max: 15 } }, audio: true });
      } 
      else {
        // 3. TOUT LE RESTE : Le Téléphone OU celui qui DÉCROCHE l'appel
        // (Celui qui décroche la télé ne partage pas son écran, juste son micro pour parler)
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      }
      
      localStreamRef.current = stream;
      // On n'affiche notre propre retour vidéo que si on partage l'écran ou la caméra
      if (localVideoRef.current && (currentDevice === 'pc' || (currentDevice === 'tv' && !incomingOffer))) {
        localVideoRef.current.srcObject = stream;
      }
      setMediaActive(true);
    } catch (error) {
      alert("Erreur média. Sur mobile, vérifiez les permissions. Si vous avez annulé le partage d'écran, réessayez.");
    }
  };

  const setupPeerConnection = async () => {
    const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
    if (localStreamRef.current) localStreamRef.current.getTracks().forEach(track => pc.addTrack(track, localStreamRef.current));
    pc.ontrack = (event) => {
      if (remoteVideoRef.current && !remoteVideoRef.current.srcObject) remoteVideoRef.current.srcObject = event.streams[0];
    };
    pc.onicecandidate = (event) => {
      if (event.candidate && wsRef.current) wsRef.current.send(JSON.stringify({ type: 'ice-candidate', candidate: event.candidate }));
    };
    pcRef.current = pc;
  };

  const callUser = async () => {
    if (!isConnected) return alert("Non connecté au serveur.");
    await setupPeerConnection();
    const offer = await pcRef.current.createOffer();
    
    // Bride la vidéo uniquement si c'est la caméra du PC
    if (currentDevice === 'pc') {
      offer.sdp = offer.sdp.replace(/a=mid:video\r\n/g, 'a=mid:video\r\n' + 'b=AS:100\r\n');
    }
    await pcRef.current.setLocalDescription(offer);
    wsRef.current.send(JSON.stringify({ type: 'offer', sdp: offer, device: currentDevice }));
  };

  const acceptCall = async () => {
    await startMedia(); 
    await setupPeerConnection(); 
    await pcRef.current.setRemoteDescription(new RTCSessionDescription(incomingOffer.sdp));
    const answer = await pcRef.current.createAnswer();
    await pcRef.current.setLocalDescription(answer);
    wsRef.current.send(JSON.stringify({ type: 'answer', sdp: answer })); 
    setIncomingOffer(null); 
  };

  const stopCall = () => {
    if (localStreamRef.current) localStreamRef.current.getTracks().forEach(t => t.stop());
    if (pcRef.current) pcRef.current.close();
    setMediaActive(false);
    setCurrentDevice(null);
    setIncomingOffer(null); 
  };

  // ==========================================
  // 4. INTERFACES (UI & 3D)
  // ==========================================
  if (!isEntered) {
    return (
      <div style={{ width: '100vw', height: '100vh', backgroundColor: '#d4c3b3', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ backgroundColor: 'white', padding: '40px', borderRadius: '15px', textAlign: 'center', boxShadow: '0 10px 25px rgba(0,0,0,0.2)' }}>
          <h1 style={{ color: '#5c4033', marginBottom: '10px' }}>Notre Maison</h1>
          <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
            <input type="password" placeholder="Clé secrète" value={secretPwd} onChange={(e) => setSecretPwd(e.target.value)} style={{ padding: '12px', borderRadius: '8px', border: '1px solid #ccc' }} />
            <button type="submit" style={{ padding: '12px', backgroundColor: '#5c4033', color: 'white', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold' }}>Déverrouiller la porte</button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div style={{ width: '100vw', height: '100vh', backgroundColor: '#f0e6d2', position: 'relative' }}>
      
      {/* UI POUR PC ET TÉLÉ */}
      {(currentDevice === 'pc' || currentDevice === 'tv') && (
        <div style={{ position: 'absolute', top: 0, left: 0, width: '100vw', height: '100vh', backgroundColor: 'rgba(0, 0, 0, 0.85)', zIndex: 10, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'white' }}>
          <h2 style={{ marginBottom: '20px' }}>
            {incomingOffer && incomingOffer.device === 'tv' ? 'Cinéma en cours...' : currentDevice === 'pc' ? 'Appel Vidéo' : 'Partager un film (Cinéma)'}
          </h2>
          
          <div style={{ display: 'flex', gap: '20px', marginBottom: '30px' }}>
            {/* Vidéo principale (L'autre personne ou le film) */}
            <video ref={remoteVideoRef} autoPlay playsInline style={{ width: '600px', height: '400px', backgroundColor: '#111', borderRadius: '10px', boxShadow: '0 0 20px rgba(0,0,0,0.5)' }}></video>
            
            {/* Notre propre retour vidéo (caché si on est juste au téléphone ou si on regarde la télé sans partager) */}
            <video ref={localVideoRef} autoPlay playsInline muted style={{ width: '300px', height: '200px', backgroundColor: '#222', borderRadius: '10px', display: (!incomingOffer && currentDevice !== 'phone') ? 'block' : 'none' }}></video>
          </div>

          <div style={{ display: 'flex', gap: '15px' }}>
            {incomingOffer && incomingOffer.device === currentDevice ? (
              <button onClick={acceptCall} style={{ padding: '12px 24px', cursor: 'pointer', backgroundColor: '#4CAF50', color: 'white', border: 'none', borderRadius: '5px', fontWeight: 'bold' }}>📞 Rejoindre avec le Micro</button>
            ) : !mediaActive ? (
              <button onClick={startMedia} style={{ padding: '12px 24px', cursor: 'pointer', backgroundColor: '#2196F3', color: 'white', border: 'none', borderRadius: '5px' }}>{currentDevice === 'pc' ? '📷 Activer la caméra' : '🖥️ Choisir l\'écran à partager'}</button>
            ) : (
              <button onClick={callUser} style={{ padding: '12px 24px', cursor: 'pointer', backgroundColor: '#4CAF50', color: 'white', border: 'none', borderRadius: '5px' }}>📞 Appeler</button>
            )}
            <button onClick={stopCall} style={{ padding: '12px 24px', cursor: 'pointer', backgroundColor: '#f44336', color: 'white', border: 'none', borderRadius: '5px' }}>✖ {incomingOffer ? 'Refuser' : 'Raccrocher'}</button>
          </div>
        </div>
      )}

      {/* UI POUR TÉLÉPHONE (Panneau flottant) */}
      {currentDevice === 'phone' && (
        <div style={{ position: 'absolute', top: '20px', right: '20px', backgroundColor: 'white', padding: '20px', borderRadius: '10px', zIndex: 10, boxShadow: '0 4px 15px rgba(0,0,0,0.2)' }}>
          <h3 style={{ margin: '0 0 15px 0', color: '#333' }}>📞 Téléphone</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {incomingOffer && incomingOffer.device === 'phone' ? (
              <button onClick={acceptCall} style={{ padding: '10px', backgroundColor: '#4CAF50', color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer', fontWeight: 'bold' }}>Décrocher (Micro)</button>
            ) : !mediaActive ? (
              <button onClick={startMedia} style={{ padding: '10px', backgroundColor: '#2196F3', color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer' }}>🎤 Activer le micro</button>
            ) : (
              <button onClick={callUser} style={{ padding: '10px', backgroundColor: '#4CAF50', color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer' }}>Sonner</button>
            )}
            <button onClick={stopCall} style={{ padding: '10px', backgroundColor: '#f44336', color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer' }}>{incomingOffer ? 'Refuser' : 'Raccrocher'}</button>
          </div>
          <video ref={remoteVideoRef} autoPlay playsInline style={{ display: 'none' }}></video>
        </div>
      )}

      {/* UI POUR LA RADIO SPOTIFY */}
      {currentDevice === 'radio' && (
        <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', backgroundColor: '#191414', padding: '20px', borderRadius: '15px', zIndex: 10, boxShadow: '0 4px 15px rgba(0,0,0,0.5)', width: '350px' }}>
          <h3 style={{ margin: '0 0 15px 0', color: '#1DB954', textAlign: 'center' }}>🎵 Notre Playlist</h3>
          
          {mediaActive ? (
            <div style={{ color: 'white', textAlign: 'center', padding: '20px' }}>
              <p>🔇 La radio est indisponible pendant les appels.</p>
            </div>
          ) : (
            <iframe 
              style={{ borderRadius: '12px' }} 
              src={SPOTIFY_PLAYLIST_URL} 
              width="100%" height="352" frameBorder="0" allowFullScreen="" 
              allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" loading="lazy">
            </iframe>
          )}
          
          <button onClick={() => setCurrentDevice(null)} style={{ marginTop: '15px', width: '100%', padding: '10px', backgroundColor: '#333', color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer', fontWeight: 'bold' }}>
            Retour à la chambre
          </button>
        </div>
      )}

      {/* Statut Réseau */}
      <div style={{ position: 'absolute', top: 10, left: 10, zIndex: 5, color: isConnected ? 'green' : 'red', fontWeight: 'bold', backgroundColor: 'rgba(255,255,255,0.8)', padding: '5px 10px', borderRadius: '20px' }}>
        {isConnected ? "🟢 En ligne" : "🔴 Hors ligne"}
      </div>

      {/* --- LE MONDE 3D --- */}
      <Canvas camera={{ position: [0, 2, 5], fov: 50 }}>
        <ambientLight intensity={0.5} />
        <directionalLight position={[5, 5, 5]} intensity={1} castShadow />
        
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.5, 0]}><planeGeometry args={[10, 10]} /><meshStandardMaterial color="#d4c3b3" /></mesh>
        
        {/* BUREAU */}
        <mesh position={[-1.5, 0, 0]}><boxGeometry args={[1.5, 1, 1]} /><meshStandardMaterial color="#cda47b" /></mesh>
        
        {/* PC */}
        <mesh position={[-1.3, 0.75, 0]} onClick={(e) => { e.stopPropagation(); setCurrentDevice('pc'); }} onPointerEnter={() => document.body.style.cursor = 'pointer'} onPointerLeave={() => document.body.style.cursor = 'auto'}>
          <boxGeometry args={[0.5, 0.4, 0.1]} />
          <meshStandardMaterial color={incomingOffer?.device === 'pc' && blink ? "#ffffff" : (currentDevice === 'pc' ? "#4CAF50" : "#4a90e2")} />
        </mesh>
        
        {/* TÉLÉPHONE */}
        <mesh position={[-1.9, 0.55, 0.2]} onClick={(e) => { e.stopPropagation(); setCurrentDevice('phone'); }} onPointerEnter={() => document.body.style.cursor = 'pointer'} onPointerLeave={() => document.body.style.cursor = 'auto'}>
          <boxGeometry args={[0.15, 0.1, 0.2]} />
          <meshStandardMaterial color={incomingOffer?.device === 'phone' && blink ? "#ffffff" : (currentDevice === 'phone' ? "#4CAF50" : "#e74c3c")} />
        </mesh>

        {/* ÉTAGÈRE & TÉLÉVISION */}
        <mesh position={[1.5, -0.2, -0.5]}><boxGeometry args={[1.5, 0.6, 0.8]} /><meshStandardMaterial color="#5c4033" /></mesh>
        <mesh position={[1.5, 0.4, -0.5]} onClick={(e) => { e.stopPropagation(); setCurrentDevice('tv'); }} onPointerEnter={() => document.body.style.cursor = 'pointer'} onPointerLeave={() => document.body.style.cursor = 'auto'}>
          <boxGeometry args={[1.2, 0.7, 0.1]} />
          <meshStandardMaterial color={incomingOffer?.device === 'tv' && blink ? "#ffffff" : (currentDevice === 'tv' ? "#4CAF50" : "#222222")} />
        </mesh>

        {/* TABLE BASSE & RADIO */}
        <mesh position={[0, -0.3, 1.2]}><boxGeometry args={[1, 0.4, 0.8]} /><meshStandardMaterial color="#8b5a2b" /></mesh>
        <mesh position={[0, -0.05, 1.2]} onClick={(e) => { e.stopPropagation(); setCurrentDevice('radio'); }} onPointerEnter={() => document.body.style.cursor = 'pointer'} onPointerLeave={() => document.body.style.cursor = 'auto'}>
          <boxGeometry args={[0.3, 0.2, 0.15]} />
          <meshStandardMaterial color="#1DB954" />
        </mesh>

        <OrbitControls />
      </Canvas>
    </div>
  )
}

export default App