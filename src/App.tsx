/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo, Component } from 'react';
import { 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  signOut, 
  onAuthStateChanged,
  updatePassword,
  User as FirebaseUser
} from 'firebase/auth';
import { 
  doc, 
  setDoc, 
  getDoc, 
  getDocs, 
  collection, 
  query, 
  where, 
  onSnapshot, 
  runTransaction,
  serverTimestamp,
  updateDoc,
  orderBy
} from 'firebase/firestore';
import { auth, db } from './firebase';
import { motion, AnimatePresence } from 'motion/react';
import { QRCodeSVG } from 'qrcode.react';
import { 
  Wallet, 
  Send, 
  LogOut, 
  User, 
  Shield, 
  Plus, 
  Users, 
  ArrowRightLeft,
  AlertCircle,
  CheckCircle2,
  X,
  CreditCard,
  History,
  QrCode,
  Copy,
  Download,
  TrendingUp,
  Bitcoin,
  ArrowUpRight,
  ArrowDownRight,
  Dices,
  Trophy,
  Zap,
  CircleDot
} from 'lucide-react';

// --- Types ---
interface UserData {
  uid: string;
  nome: string;
  email: string;
  pixKey: string;
  saldo: number;
  createdAt: any;
  role?: string;
  btcBalance?: number;
  ethBalance?: number;
  solBalance?: number;
}

interface TransactionData {
  id: string;
  senderUid: string;
  senderName: string;
  recipientUid: string;
  recipientName: string;
  amount: number;
  timestamp: any;
}

interface CardData {
  id: string;
  cardNumber: string;
  expiry: string;
  cvv: string;
  holderName: string;
  type: 'virtual' | 'physical';
  status: 'active' | 'blocked';
  createdAt: any;
}

interface Toast {
  id: number;
  message: string;
  type: 'success' | 'error';
}

// --- Error Handling ---
enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string;
    email?: string | null;
    emailVerified?: boolean;
    isAnonymous?: boolean;
    tenantId?: string | null;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: any;
}

class ErrorBoundary extends Component<any, any> {
  state = {
    hasError: false,
    error: null
  };

  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      let message = "Ocorreu um erro inesperado.";
      try {
        const parsed = JSON.parse((this.state.error as any).message);
        if (parsed.error) message = `Erro no Banco de Dados: ${parsed.error}`;
      } catch (e) {
        message = (this.state.error as any)?.message || message;
      }

      return (
        <div className="min-h-screen flex items-center justify-center bg-red-50 p-4">
          <div className="bg-white p-8 rounded-2xl shadow-xl border border-red-100 max-w-md w-full text-center">
            <AlertCircle size={48} className="text-red-500 mx-auto mb-4" />
            <h2 className="text-xl font-bold text-gray-800 mb-2">Ops! Algo deu errado</h2>
            <p className="text-gray-600 mb-6">{message}</p>
            <button 
              onClick={() => window.location.reload()}
              className="bg-red-600 text-white px-6 py-2 rounded-xl font-bold hover:bg-red-700 transition-colors"
            >
              Recarregar Aplicativo
            </button>
          </div>
        </div>
      );
    }
    return (this as any).props.children;
  }
}
const ToastContainer = ({ toasts, removeToast }: { toasts: Toast[], removeToast: (id: number) => void }) => (
  <div className="fixed top-4 right-4 z-50 flex flex-col gap-2">
    <AnimatePresence>
      {toasts.map((toast) => (
        <motion.div
          key={toast.id}
          initial={{ opacity: 0, x: 50 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 50 }}
          className={`flex items-center gap-3 p-4 rounded-lg shadow-lg min-w-[300px] ${
            toast.type === 'success' ? 'bg-green-500 text-white' : 'bg-red-500 text-white'
          }`}
        >
          {toast.type === 'success' ? <CheckCircle2 size={20} /> : <AlertCircle size={20} />}
          <span className="flex-1 font-medium">{toast.message}</span>
          <button onClick={() => removeToast(toast.id)} className="hover:opacity-70">
            <X size={18} />
          </button>
        </motion.div>
      ))}
    </AnimatePresence>
  </div>
);

export default function App() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [userData, setUserData] = useState<UserData | null>(null);
  const [transactions, setTransactions] = useState<TransactionData[]>([]);
  const [cards, setCards] = useState<CardData[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'login' | 'register' | 'dashboard' | 'admin'>('login');
  const [dashboardSection, setDashboardSection] = useState<'main' | 'cards' | 'history' | 'security' | 'investments' | 'casino'>('main');
  const [isQrModalOpen, setIsQrModalOpen] = useState(false);
  const [isNfcModalOpen, setIsNfcModalOpen] = useState(false);
  const [nfcStep, setNfcStep] = useState<'start' | 'scanning' | 'success' | 'error'>('start');
  const [nfcAmount, setNfcAmount] = useState<string>('');
  const [nfcRecipient, setNfcRecipient] = useState<string>('');
  const [selectedNfcCard, setSelectedNfcCard] = useState<string>('balance');
  const [qrAmount, setQrAmount] = useState<string>('');
  const [toasts, setToasts] = useState<Toast[]>([]);
  
  // Crypto State
  const [cryptoPrice, setCryptoPrice] = useState<number | null>(null);
  const [cryptoHistory, setCryptoHistory] = useState<number[]>([]);
  const [cryptoChange, setCryptoChange] = useState<number>(0);
  const [isInvesting, setIsInvesting] = useState(false);
  const [investAction, setInvestAction] = useState<'buy' | 'sell'>('buy');
  const [investAmount, setInvestAmount] = useState<string>('');
  const [casinoSubTab, setCasinoSubTab] = useState<'lion' | 'bitcoin' | 'crash' | 'double' | 'roulette'>('lion');
  const [investCrypto, setInvestCrypto] = useState<'BTC' | 'ETH' | 'SOL'>('BTC');

  // Lion Game State
  const [betAmount, setBetAmount] = useState<string>('');
  const [isSpinning, setIsSpinning] = useState(false);
  const [slotResult, setSlotResult] = useState<string[]>(['LION', 'LION', 'LION']);
  const [gameMessage, setGameMessage] = useState('FAÇA SUA APOSTA');

  // Crash State
  const [crashMultiplier, setCrashMultiplier] = useState(1.0);
  const [crashStatus, setCrashStatus] = useState<'idle' | 'running' | 'crashed' | 'cashed'>('idle');
  const [crashBet, setCrashBet] = useState<string>('');
  const [hasCashedOut, setHasCashedOut] = useState(false);

  // Roulette State
  const [rouletteBetAmount, setRouletteBetAmount] = useState<string>('');
  const [rouletteSelection, setRouletteSelection] = useState<string | number>('red');
  const [isRouletteSpinning, setIsRouletteSpinning] = useState(false);
  const [rouletteResult, setRouletteResult] = useState<number | null>(null);
  const [rouletteHistory, setRouletteHistory] = useState<number[]>([]);
  const [doubleBetAmount, setDoubleBetAmount] = useState<string>('');
  const [doubleColor, setDoubleColor] = useState<'orange' | 'black' | 'gold'>('orange');
  const [isDoubleSpinning, setIsDoubleSpinning] = useState(false);
  const [doubleResult, setDoubleResult] = useState<string | null>(null);
  const [doubleHistory, setDoubleHistory] = useState<string[]>([]);

  const renderSlotSymbol = (symbol: string) => {
    switch (symbol) {
      case 'LION':
        return (
          <svg viewBox="0 0 24 24" className="w-16 h-16 text-orange-500 fill-none stroke-current stroke-[1.2]">
            <path d="M12 4C7.58 4 4 7.58 4 12s3.58 8 8 8 8-3.58 8-8-3.58-8-8-8zm0 14.5c-3.59 0-6.5-2.91-6.5-6.5S8.41 5.5 12 5.5s6.5 2.91 6.5 6.5-2.91 6.5-6.5 6.5z" />
            <path d="M12 8c-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4-1.79-4-4-4zm0 6.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" />
            <path d="M10.5 11c-.28 0-.5.22-.5.5s.22.5.5.5.5-.22.5-.5-.22-.5-.5-.5zm3 0c-.28 0-.5.22-.5.5s.22.5.5.5.5-.22.5-.5-.22-.5-.5-.5z" />
            <path d="M12 13v2m-1-1h2" />
            <path d="M8 8.5L9.5 10M16 8.5L14.5 10M9 15l-1.5 1.5M15 15l1.5 1.5" />
            <path d="M6 12h1M17 12h1M12 6V5M12 19v-1" />
          </svg>
        );
      case 'FIRE':
        return <Zap size={56} className="text-red-500 stroke-[1.5]" />;
      case 'DIAMOND':
        return <Trophy size={56} className="text-blue-400 stroke-[1.5]" />;
      case 'ORANGE':
        return <Dices size={56} className="text-orange-400 stroke-[1.5]" />;
      case 'SEVEN':
        return <span className="text-7xl font-black text-white/80 italic outline-text">7</span>;
      default:
        return null;
    }
  };
  
  // Admin State
  const [isAdminLoggedIn, setIsAdminLoggedIn] = useState(false);
  const [allUsers, setAllUsers] = useState<UserData[]>([]);

  // Toast Helper
  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    const id = Date.now();
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3000);
  };

  const removeToast = (id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  // Fetch Crypto Price
  useEffect(() => {
    const fetchPrice = async () => {
      try {
        const coinMap: {[key: string]: string} = {
          'BTC': 'bitcoin',
          'ETH': 'ethereum',
          'SOL': 'solana'
        };
        const coinId = coinMap[investCrypto] || 'bitcoin';
        const response = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=brl&include_24hr_change=true`);
        const data = await response.json();
        const price = data[coinId].brl;
        const change = data[coinId].brl_24h_change;
        
        setCryptoPrice(price);
        setCryptoChange(change);
        setCryptoHistory(prev => {
          const newHistory = [...prev, price].slice(-20);
          return newHistory;
        });
      } catch (error) {
        console.error('Error fetching crypto price:', error);
      }
    };

    if (dashboardSection === 'casino' || dashboardSection === 'investments') {
      fetchPrice();
      const interval = setInterval(fetchPrice, 30000); // 30 seconds
      return () => clearInterval(interval);
    }
  }, [dashboardSection, investCrypto]);

  // Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      if (u) {
        // Redireciona para o dashboard se estiver nas telas de auth
        if (view === 'login' || view === 'register') {
          setView('dashboard');
        }
      } else {
        // Redireciona para login apenas se não for uma rota pública autorizada
        if (view !== 'login' && view !== 'register' && view !== 'admin') {
          setView('login');
        }
      }
      setLoading(false);
    });
    return unsubscribe;
  }, [view]);

  // Real-time User Data Listener
  useEffect(() => {
    if (!user) {
      setUserData(null);
      return;
    }

    const unsubscribe = onSnapshot(doc(db, 'users', user.uid), (docSnap) => {
      if (docSnap.exists()) {
        setUserData(docSnap.data() as UserData);
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, `users/${user.uid}`);
    });

    return unsubscribe;
  }, [user]);

  // Real-time Transactions Listener
  useEffect(() => {
    if (!user) {
      setTransactions([]);
      return;
    }

    // Query for transactions where user is sender
    const qSender = query(
      collection(db, 'transactions'),
      where('senderUid', '==', user.uid)
    );

    // Query for transactions where user is recipient
    const qRecipient = query(
      collection(db, 'transactions'),
      where('recipientUid', '==', user.uid)
    );

    const handleSnapshot = (snapshot: any) => {
      const txs = snapshot.docs.map((d: any) => ({ id: d.id, ...d.data() } as TransactionData));
      setTransactions(prev => {
        const combined = [...prev, ...txs];
        // Remove duplicates and sort
        const unique = Array.from(new Map(combined.map(item => [item.id, item])).values());
        return unique.sort((a, b) => b.timestamp?.seconds - a.timestamp?.seconds);
      });
    };

    const unsubSender = onSnapshot(qSender, handleSnapshot, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'transactions (sender)');
    });

    const unsubRecipient = onSnapshot(qRecipient, handleSnapshot, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'transactions (recipient)');
    });

    return () => {
      unsubSender();
      unsubRecipient();
    };
  }, [user]);

  // Real-time Cards Listener
  useEffect(() => {
    if (!user) {
      setCards([]);
      return;
    }

    const unsubscribe = onSnapshot(collection(db, 'users', user.uid, 'cards'), (snapshot) => {
      const cardList = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as CardData));
      setCards(cardList);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, `users/${user.uid}/cards`);
    });

    return unsubscribe;
  }, [user]);

  // Admin: Real-time All Users Listener
  useEffect(() => {
    if (!isAdminLoggedIn) return;

    const unsubscribe = onSnapshot(collection(db, 'users'), (snapshot) => {
      const users = snapshot.docs.map(d => d.data() as UserData);
      setAllUsers(users);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'users');
    });

    return unsubscribe;
  }, [isAdminLoggedIn]);

  // --- Actions ---

  const [isRegistering, setIsRegistering] = useState(false);

  const handleRegister = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (isRegistering) return;
    
    const formData = new FormData(e.currentTarget);
    const nome = formData.get('nome') as string;
    const email = (formData.get('email') as string).toLowerCase().trim();
    const pixKey = (formData.get('pixKey') as string || email).toLowerCase().trim();
    const senha = formData.get('senha') as string;
    const confirmarSenha = formData.get('confirmarSenha') as string;

    if (senha !== confirmarSenha) {
      return showToast('As senhas não coincidem', 'error');
    }

    setIsRegistering(true);
    try {
      // Check if pixKey already exists
      const qPix = query(collection(db, 'users'), where('pixKey', '==', pixKey));
      const pixSnap = await getDocs(qPix);
      if (!pixSnap.empty) {
        setIsRegistering(false);
        return showToast('Esta chave PIX já está em uso', 'error');
      }

      const userCredential = await createUserWithEmailAndPassword(auth, email, senha);
      const newUser = userCredential.user;

      await setDoc(doc(db, 'users', newUser.uid), {
        uid: newUser.uid,
        nome,
        email,
        pixKey,
        saldo: 1000,
        createdAt: serverTimestamp(),
        role: 'user'
      });

      showToast('Conta criada com sucesso!');
      // O setView('dashboard') será tratado pelo onAuthStateChanged
    } catch (error: any) {
      showToast(error.message, 'error');
    } finally {
      setIsRegistering(false);
    }
  };

  const [isLoggingIn, setIsLoggingIn] = useState(false);

  const handleLogin = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (isLoggingIn) return;

    const formData = new FormData(e.currentTarget);
    const email = formData.get('email') as string;
    const senha = formData.get('senha') as string;

    setIsLoggingIn(true);
    try {
      await signInWithEmailAndPassword(auth, email, senha);
      showToast('Bem-vindo ao FrontBank08!');
    } catch (error: any) {
      showToast('Email ou senha incorretos', 'error');
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogout = async () => {
    await signOut(auth);
    setIsAdminLoggedIn(false);
    setView('login');
    showToast('Até logo!');
  };

  const handlePix = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!userData) return;

    const formData = new FormData(e.currentTarget);
    const destPixKey = (formData.get('destPixKey') as string).toLowerCase().trim();
    const valor = parseFloat(formData.get('valor') as string);

    if (isNaN(valor) || valor <= 0) {
      return showToast('Valor inválido', 'error');
    }

    if (valor > userData.saldo) {
      return showToast('Saldo insuficiente', 'error');
    }

    if (destPixKey === userData.pixKey || destPixKey === userData.email) {
      return showToast('Você não pode enviar PIX para si mesmo', 'error');
    }

    try {
      // Find recipient by pixKey or email
      const q = query(collection(db, 'users'), where('pixKey', '==', destPixKey));
      let querySnapshot = await getDocs(q);

      if (querySnapshot.empty) {
        // Try email if pixKey search fails (legacy or if key is email)
        const qEmail = query(collection(db, 'users'), where('email', '==', destPixKey));
        querySnapshot = await getDocs(qEmail);
      }

      if (querySnapshot.empty) {
        return showToast('Chave PIX não encontrada', 'error');
      }

      const recipientDoc = querySnapshot.docs[0];
      const recipientData = recipientDoc.data() as UserData;

      // Transaction
      await runTransaction(db, async (transaction) => {
        const senderRef = doc(db, 'users', userData.uid);
        const recipientRef = doc(db, 'users', recipientData.uid);
        const transactionRef = doc(collection(db, 'transactions'));

        const senderSnap = await transaction.get(senderRef);
        if (!senderSnap.exists()) throw new Error("Remetente não encontrado");

        const currentSaldo = senderSnap.data().saldo;
        if (currentSaldo < valor) throw new Error("Saldo insuficiente");

        transaction.update(senderRef, { saldo: currentSaldo - valor });
        transaction.update(recipientRef, { saldo: recipientData.saldo + valor });
        
        transaction.set(transactionRef, {
          senderUid: userData.uid,
          senderName: userData.nome,
          recipientUid: recipientData.uid,
          recipientName: recipientData.nome,
          amount: valor,
          timestamp: serverTimestamp()
        });
      });

      showToast(`PIX de R$ ${valor.toFixed(2)} enviado com sucesso!`);
      e.currentTarget.reset();
    } catch (error: any) {
      try {
        handleFirestoreError(error, OperationType.WRITE, 'transactions/pix_transfer');
      } catch (e) {
        showToast(error.message || 'Erro no PIX', 'error');
      }
    }
  };

  const handleAdminLogin = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const user = formData.get('adminUser') as string;
    const pass = formData.get('adminPass') as string;

    if (user === 'FrontWork' && pass === '61199262') {
      setIsAdminLoggedIn(true);
      setView('admin');
      showToast('Painel Administrativo acessado');
    } else {
      showToast('Credenciais administrativas inválidas', 'error');
    }
  };

  const updateBalanceAdmin = async (uid: string, newBalance: number) => {
    try {
      await updateDoc(doc(db, 'users', uid), { saldo: newBalance });
      showToast('Saldo atualizado com sucesso');
    } catch (error: any) {
      showToast(error.message, 'error');
    }
  };

  const createNewUserAdmin = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const nome = formData.get('nome') as string;
    const email = formData.get('email') as string;
    const senha = formData.get('senha') as string;
    const saldo = parseFloat(formData.get('saldo') as string);

    try {
      // Note: Admin creating user via Firebase Auth is tricky without Admin SDK.
      // We'll use the regular createUserWithEmailAndPassword which will log the admin out.
      // For a demo, we'll just show a message or use a mock approach if needed.
      // But let's try to do it for real.
      const userCredential = await createUserWithEmailAndPassword(auth, email, senha);
      const newUser = userCredential.user;

      await setDoc(doc(db, 'users', newUser.uid), {
        uid: newUser.uid,
        nome,
        email,
        saldo: saldo || 1000,
        createdAt: serverTimestamp(),
        role: 'user'
      });

      showToast('Novo usuário criado com sucesso!');
      e.currentTarget.reset();
    } catch (error: any) {
      showToast(error.message, 'error');
    }
  };

  const handleNfcPayment = async () => {
    if (!userData || !nfcAmount || !nfcRecipient) return;
    const amount = parseFloat(nfcAmount);
    
    if (isNaN(amount) || amount <= 0) {
      return showToast('Valor inválido', 'error');
    }

    if (amount > userData.saldo) {
      setNfcStep('error');
      return showToast('Saldo insuficiente', 'error');
    }

    setNfcStep('scanning');

    // Simulate scanning delay
    setTimeout(async () => {
      try {
        const q = query(collection(db, 'users'), where('pixKey', '==', nfcRecipient.toLowerCase().trim()));
        let querySnapshot = await getDocs(q);

        if (querySnapshot.empty) {
          const qEmail = query(collection(db, 'users'), where('email', '==', nfcRecipient.toLowerCase().trim()));
          querySnapshot = await getDocs(qEmail);
        }

        if (querySnapshot.empty) {
          setNfcStep('error');
          return showToast('Destinatário não encontrado', 'error');
        }

        const recipientData = querySnapshot.docs[0].data() as UserData;

        await runTransaction(db, async (transaction) => {
          const senderRef = doc(db, 'users', userData.uid);
          const recipientRef = doc(db, 'users', recipientData.uid);
          const transactionRef = doc(collection(db, 'transactions'));

          const senderSnap = await transaction.get(senderRef);
          const currentSaldo = senderSnap.data().saldo;
          
          transaction.update(senderRef, { saldo: currentSaldo - amount });
          transaction.update(recipientRef, { saldo: recipientData.saldo + amount });
          
          transaction.set(transactionRef, {
            from: userData.uid,
            to: recipientData.uid,
            senderUid: userData.uid,
            senderName: userData.nome,
            recipientUid: recipientData.uid,
            recipientName: recipientData.nome,
            amount: amount,
            type: 'NFC_PAYMENT',
            paymentSource: selectedNfcCard === 'balance' ? 'CONTA' : `CARTAO_VIRTUAL_${selectedNfcCard.slice(-4)}`,
            timestamp: serverTimestamp()
          });
        });

        setNfcStep('success');
        showToast('Pagamento via Aproximação realizado!');
      } catch (error: any) {
        setNfcStep('error');
        try {
          handleFirestoreError(error, OperationType.WRITE, 'transactions/nfc_payment');
        } catch (e) {
          // handleFirestoreError re-throws, we want to catch the original for the toast
          showToast(error.message || 'Erro na transação. Verifique as permissões.', 'error');
        }
      }
    }, 2500);
  };

  const handleUpdatePixKey = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!userData) return;

    const formData = new FormData(e.currentTarget);
    const newPixKey = (formData.get('newPixKey') as string).toLowerCase().trim();

    if (!newPixKey) return showToast('A chave PIX não pode ser vazia', 'error');

    try {
      // Check if pixKey already exists
      const qPix = query(collection(db, 'users'), where('pixKey', '==', newPixKey));
      const pixSnap = await getDocs(qPix);
      
      if (!pixSnap.empty && pixSnap.docs[0].id !== userData.uid) {
        return showToast('Esta chave PIX já está em uso por outro usuário', 'error');
      }

      await updateDoc(doc(db, 'users', userData.uid), { pixKey: newPixKey });
      showToast('Chave PIX atualizada com sucesso!');
      (e.target as HTMLFormElement).reset();
    } catch (error: any) {
      showToast(error.message, 'error');
    }
  };

  const handleCreateCard = async () => {
    if (!user || !userData) return;

    try {
      const cardRef = doc(collection(db, 'users', user.uid, 'cards'));
      const cardNumber = Array.from({ length: 4 }, () => Math.floor(1000 + Math.random() * 9000)).join(' ');
      const expiry = `${String(Math.floor(Math.random() * 12) + 1).padStart(2, '0')}/${String(new Date().getFullYear() + 4).slice(-2)}`;
      const cvv = Math.floor(100 + Math.random() * 900).toString();

      await setDoc(cardRef, {
        cardNumber,
        expiry,
        cvv,
        holderName: userData.nome.toUpperCase(),
        type: 'virtual',
        status: 'active',
        createdAt: serverTimestamp()
      });

      showToast('Cartão virtual gerado com sucesso!');
    } catch (error: any) {
      showToast(error.message, 'error');
    }
  };

  const handleUpdatePassword = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!user) return;

    const formData = new FormData(e.currentTarget);
    const novaSenha = formData.get('novaSenha') as string;
    const confirmarNovaSenha = formData.get('confirmarNovaSenha') as string;

    if (novaSenha !== confirmarNovaSenha) {
      return showToast('As senhas não coincidem', 'error');
    }

    if (novaSenha.length < 6) {
      return showToast('A senha deve ter pelo menos 6 caracteres', 'error');
    }

    try {
      await updatePassword(user, novaSenha);
      showToast('Senha atualizada com sucesso!');
      (e.target as HTMLFormElement).reset();
    } catch (error: any) {
      if (error.code === 'auth/requires-recent-login') {
        showToast('Para alterar a senha, você precisa ter feito login recentemente. Refaça o login.', 'error');
      } else {
        showToast(error.message, 'error');
      }
    }
  };

  const toggleCardStatus = async (cardId: string, currentStatus: string) => {
    if (!user) return;
    try {
      await updateDoc(doc(db, 'users', user.uid, 'cards', cardId), {
        status: currentStatus === 'active' ? 'blocked' : 'active'
      });
      showToast(currentStatus === 'active' ? 'Cartão bloqueado' : 'Cartão desbloqueado');
    } catch (error: any) {
      showToast(error.message, 'error');
    }
  };

  const handleBitcoinTrade = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userData || !cryptoPrice) return;

    const amount = parseFloat(investAmount);
    if (isNaN(amount) || amount <= 0) {
      showToast('Digite um valor válido', 'error');
      return;
    }

    setIsInvesting(true);
    try {
      await runTransaction(db, async (transaction) => {
        const userRef = doc(db, 'users', userData.uid);
        const userDoc = await transaction.get(userRef);
        if (!userDoc.exists()) throw new Error('Usuário não encontrado');

        const currentData = userDoc.data() as UserData;
        const currentBalance = currentData.saldo;
        
        const balanceField = (investCrypto === 'BTC' ? 'btcBalance' : (investCrypto === 'ETH' ? 'ethBalance' : 'solBalance')) as keyof UserData;
        const currentCryptoBalance = Number(currentData[balanceField] || 0);

        if (investAction === 'buy') {
          if (currentBalance < amount) throw new Error('Saldo insuficiente para completar esta ordem');
          
          const coinToReceive = amount / cryptoPrice;
          transaction.set(userRef, {
            saldo: currentBalance - amount,
            [balanceField]: currentCryptoBalance + coinToReceive
          }, { merge: true });

          const transRef = doc(collection(db, 'transactions'));
          transaction.set(transRef, {
            from: userData.uid,
            to: 'CRYPTO_EXCHANGE',
            senderUid: userData.uid,
            senderName: userData.nome,
            recipientUid: 'CRYPTO_EXCHANGE',
            recipientName: `Mercado ${investCrypto}`,
            tipo: 'INVESTMENT',
            amount: amount,
            cryptoAmount: coinToReceive,
            cryptoSymbol: investCrypto,
            action: 'BUY',
            timestamp: serverTimestamp()
          });
        } else {
          const coinToSell = amount / cryptoPrice;
          // Hardened check: compare with a small epsilon or strictly
          if (currentCryptoBalance < coinToSell) {
            throw new Error(`Saldo de ${investCrypto} insuficiente. Você possui ${currentCryptoBalance.toFixed(8)} ${investCrypto} e tentou vender o equivalente a ${coinToSell.toFixed(8)} ${investCrypto}`);
          }

          transaction.set(userRef, {
            saldo: currentBalance + amount,
            [balanceField]: currentCryptoBalance - coinToSell
          }, { merge: true });

          const transRef = doc(collection(db, 'transactions'));
          transaction.set(transRef, {
            from: 'CRYPTO_EXCHANGE',
            to: userData.uid,
            senderUid: 'CRYPTO_EXCHANGE',
            senderName: `Mercado ${investCrypto}`,
            recipientUid: userData.uid,
            recipientName: userData.nome,
            tipo: 'INVESTMENT',
            amount: amount,
            cryptoAmount: coinToSell,
            cryptoSymbol: investCrypto,
            action: 'SELL',
            timestamp: serverTimestamp()
          });
        }
      });

      showToast(`${investAction === 'buy' ? 'Compra' : 'Venda'} de ${investCrypto} realizada com sucesso!`);
      setInvestAmount('');
    } catch (error: any) {
      showToast(error.message || 'Erro na operação', 'error');
    } finally {
      setIsInvesting(false);
    }
  };

  const handleLionLuck = async () => {
    if (!userData || isSpinning) return;
    const amount = parseFloat(betAmount);
    
    if (isNaN(amount) || amount <= 0) {
      showToast('Digite um valor de aposta', 'error');
      return;
    }

    if (userData.saldo < amount) {
      showToast('Saldo insuficiente', 'error');
      return;
    }

    setIsSpinning(true);
    setGameMessage('GIRANDO...');

    // Fake spin animation
    const symbols = ['LION', 'FIRE', 'DIAMOND', 'ORANGE', 'SEVEN'];
    const timer = setInterval(() => {
      setSlotResult([
        symbols[Math.floor(Math.random() * symbols.length)],
        symbols[Math.floor(Math.random() * symbols.length)],
        symbols[Math.floor(Math.random() * symbols.length)]
      ]);
    }, 100);

    setTimeout(async () => {
      clearInterval(timer);
      const isWin = Math.random() > 0.7; // 30% win rate
      let multi = 0;
      let finalResult = [];

      if (isWin) {
        multi = Math.random() > 0.8 ? 10 : 2; // High multi chance
        const winSym = multi === 10 ? 'LION' : (Math.random() > 0.5 ? 'DIAMOND' : 'FIRE');
        finalResult = [winSym, winSym, winSym];
      } else {
        finalResult = [
          symbols[Math.floor(Math.random() * symbols.length)],
          symbols[Math.floor(Math.random() * symbols.length)],
          symbols[Math.floor(Math.random() * symbols.length)]
        ];
        // Ensure no accident win
        if (finalResult[0] === finalResult[1] && finalResult[1] === finalResult[2]) {
           finalResult[2] = finalResult[2] === 'LION' ? 'FIRE' : 'LION';
        }
      }

      setSlotResult(finalResult);

      try {
        await runTransaction(db, async (transaction) => {
          const userRef = doc(db, 'users', userData.uid);
          const userDoc = await transaction.get(userRef);
          if (!userDoc.exists()) return;

          const currentBalance = userDoc.data().saldo;
          const winAmount = isWin ? amount * multi : 0;
          
          transaction.update(userRef, {
            saldo: currentBalance - amount + winAmount
          });

          // Log
          const transRef = doc(collection(db, 'transactions'));
          transaction.set(transRef, {
            from: userData.uid,
            to: 'LION_CASINO',
            senderUid: userData.uid,
            senderName: userData.nome,
            recipientUid: 'LION_CASINO',
            recipientName: 'Lion Casino',
            tipo: 'BET',
            amount: amount,
            ganho: winAmount,
            result: isWin ? 'WIN' : 'LOSS',
            timestamp: serverTimestamp()
          });
        });

        if (isWin) {
          setGameMessage(`GANHOU R$ ${(amount * multi).toFixed(2)}!`);
          showToast(`VITÓRIA! +R$ ${(amount * multi).toFixed(2)}`, 'success');
        } else {
          setGameMessage('TENTE NOVAMENTE');
        }
      } catch (err) {
        showToast('Erro ao processar aposta', 'error');
      } finally {
        setIsSpinning(false);
      }
    }, 2000);
  };

  const startCrashGame = async () => {
    if (!userData || crashStatus === 'running') return;
    const amount = parseFloat(crashBet);

    if (isNaN(amount) || amount <= 0) {
      showToast('Digite um valor de aposta', 'error');
      return;
    }

    if (userData.saldo < amount) {
      showToast('Saldo insuficiente', 'error');
      return;
    }

    try {
      await updateDoc(doc(db, 'users', userData.uid), {
        saldo: userData.saldo - amount
      });

      setCrashMultiplier(1.0);
      setCrashStatus('running');
      setHasCashedOut(false);
      
      // Increased house edge: crash point logic
      // Math.random() < 0.1 means 10% chance to crash at 1.0x (instant rip)
      const instantRip = Math.random() < 0.12; 
      const crashPoint = instantRip ? 1.0 : (Math.random() * 5 + 1.1); // Lower average crash point
      
      let currentMulti = 1.0;
      const interval = setInterval(() => {
        // Multiplier curves up
        currentMulti += 0.01 * (currentMulti * 0.4); 
        setCrashMultiplier(currentMulti);

        if (currentMulti >= crashPoint) {
          clearInterval(interval);
          setCrashStatus('crashed');
          showToast('QUEBROU! Fim da decolagem.', 'error');
        }
      }, 100);

      (window as any).crashInterval = interval;
    } catch (error) {
      showToast('Erro ao iniciar jogo', 'error');
    }
  };

  const handleRouletteSpin = async () => {
    if (!userData || isRouletteSpinning) return;
    const amount = parseFloat(rouletteBetAmount);

    if (isNaN(amount) || amount <= 0) {
      showToast('Digite um valor de aposta', 'error');
      return;
    }

    if (userData.saldo < amount) {
      showToast('Saldo insuficiente', 'error');
      return;
    }

    setIsRouletteSpinning(true);
    setRouletteResult(null);

    setTimeout(async () => {
      const result = Math.floor(Math.random() * 37); // 0-36
      setRouletteResult(result);
      setRouletteHistory(prev => [result, ...prev].slice(0, 10));

      const redNumbers = [1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36];
      const blackNumbers = [2,4,6,8,10,11,13,15,17,20,22,24,26,28,29,31,33,35];
      const resultColor = result === 0 ? 'green' : (redNumbers.includes(result) ? 'red' : 'black');

      let isWin = false;
      let multi = 0;

      if (typeof rouletteSelection === 'string') {
        if (rouletteSelection === resultColor) {
          isWin = true;
          multi = resultColor === 'green' ? 35 : 2;
        }
      } else {
        if (rouletteSelection === result) {
          isWin = true;
          multi = 35;
        }
      }

      try {
        await updateDoc(doc(db, 'users', userData.uid), {
          saldo: userData.saldo - amount + (isWin ? amount * multi : 0)
        });

        if (isWin) {
          showToast(`VITÓRIA! +R$ ${(amount * multi).toFixed(2)}`, 'success');
        }
      } catch (err) {
        showToast('Erro ao processar', 'error');
      } finally {
        setIsRouletteSpinning(false);
      }
    }, 3000);
  };

  const cashOutCrash = async () => {
    if (!userData || crashStatus !== 'running' || hasCashedOut) return;
    
    setHasCashedOut(true);
    setCrashStatus('cashed');
    clearInterval((window as any).crashInterval);

    const amount = parseFloat(crashBet);
    const winAmount = amount * crashMultiplier;

    try {
      await updateDoc(doc(db, 'users', userData.uid), {
        saldo: userData.saldo + winAmount
      });
      showToast(`LUCRO! R$ ${winAmount.toFixed(2)}`, 'success');
    } catch (error) {
      showToast('Erro ao processar resgate', 'error');
    }
  };

  const handleDoubleSpin = async () => {
    if (!userData || isDoubleSpinning) return;
    const amount = parseFloat(doubleBetAmount);

    if (isNaN(amount) || amount <= 0) {
      showToast('Digite um valor de aposta', 'error');
      return;
    }

    if (userData.saldo < amount) {
      showToast('Saldo insuficiente', 'error');
      return;
    }

    setIsDoubleSpinning(true);
    setDoubleResult(null);

    setTimeout(async () => {
      const colors = ['orange', 'black', 'orange', 'black', 'orange', 'black', 'gold']; 
      const result = colors[Math.floor(Math.random() * colors.length)];
      setDoubleResult(result);
      setDoubleHistory(prev => [result, ...prev].slice(0, 10));

      const isWin = result === doubleColor;
      let multi = 0;
      if (isWin) {
        multi = result === 'gold' ? 14 : 2;
      }

      try {
        await updateDoc(doc(db, 'users', userData.uid), {
          saldo: userData.saldo - amount + (amount * multi)
        });

        if (isWin) {
          showToast(`VITÓRIA! +R$ ${(amount * multi).toFixed(2)}`, 'success');
        }
      } catch (err) {
        showToast('Erro ao processar', 'error');
      } finally {
        setIsDoubleSpinning(false);
      }
    }, 2000);
  };

  const getPixPayload = (key: string = '', name: string = '', amount?: number) => {
    try {
      const safeName = (name || 'BANCO SIMULADO').normalize("NFD").replace(/[\u0300-\u036f]/g, "").slice(0, 25);
      const safeKey = (key || '00000000000').toLowerCase().trim();
      
      const accountInfo = `0014br.gov.bcb.pix01${safeKey.length.toString().padStart(2, '0')}${safeKey}`;
      const payload = [
        '000201',
        `26${accountInfo.length.toString().padStart(2, '0')}${accountInfo}`,
        '52040000',
        '5303986',
        amount && amount > 0 ? `54${amount.toFixed(2).length.toString().padStart(2, '0')}${amount.toFixed(2)}` : '',
        '5802BR',
        `59${safeName.length.toString().padStart(2, '0')}${safeName.toUpperCase()}`,
        '6008BRASILIA',
        '62070503***',
      ].join('');

      const crcPart = payload + '6304';
      let crc = 0xFFFF;
      for (let i = 0; i < crcPart.length; i++) {
        crc ^= crcPart.charCodeAt(i) << 8;
        for (let j = 0; j < 8; j++) {
          if (crc & 0x8000) crc = (crc << 1) ^ 0x1021;
          else crc <<= 1;
        }
      }
      const crcHex = (crc & 0xFFFF).toString(16).toUpperCase().padStart(4, '0');
      return crcPart + crcHex;
    } catch (e) {
      console.error('Error generating PIX payload:', e);
      return 'ERRO-PIX-GEN';
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-purple-600"></div>
      </div>
    );
  }

  return (
    <ErrorBoundary>
      <div className="min-h-screen font-sans text-white">
        <ToastContainer toasts={toasts} removeToast={removeToast} />

      {/* Header */}
      <header className="p-6">
        <div className="max-w-4xl mx-auto flex justify-between items-center">
          <div className="flex items-center gap-2">
            <CreditCard size={32} className="text-white/80" />
            <h1 className="text-2xl font-bold tracking-tight">FrontBank08</h1>
          </div>
          {user && view === 'dashboard' && (
            <button 
              onClick={handleLogout}
              className="flex items-center gap-2 bg-white/10 hover:bg-white/20 border border-white/20 px-4 py-2 rounded-xl transition-all text-sm font-medium backdrop-blur-md"
            >
              <LogOut size={18} />
              Sair
            </button>
          )}
          {isAdminLoggedIn && view === 'admin' && (
            <button 
              onClick={() => { setIsAdminLoggedIn(false); setView('login'); }}
              className="flex items-center gap-2 bg-white/10 hover:bg-white/20 border border-white/20 px-4 py-2 rounded-xl transition-all text-sm font-medium backdrop-blur-md"
            >
              <LogOut size={18} />
              Sair Admin
            </button>
          )}
        </div>
      </header>

      <main className="max-w-4xl mx-auto p-4 md:p-8">
        <AnimatePresence mode="wait">
          {/* Login View */}
          {view === 'login' && (
            <motion.div
              key="login"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="max-w-md mx-auto"
            >
              <div className="bg-white/10 backdrop-blur-2xl p-8 rounded-[24px] shadow-2xl border border-white/20">
                <h2 className="text-2xl font-bold mb-6 text-center text-white">Acesse sua conta</h2>
                <form onSubmit={handleLogin} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-white/80 mb-1">Email</label>
                    <input 
                      name="email" 
                      type="email" 
                      required 
                      className="w-full px-4 py-3 rounded-xl bg-white/10 border border-white/20 text-white placeholder:text-white/40 focus:ring-2 focus:ring-white/30 outline-none transition-all"
                      placeholder="seu@email.com"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-white/80 mb-1">Senha</label>
                    <input 
                      name="senha" 
                      type="password" 
                      required 
                      className="w-full px-4 py-3 rounded-xl bg-white/10 border border-white/20 text-white placeholder:text-white/40 focus:ring-2 focus:ring-white/30 outline-none transition-all"
                      placeholder="••••••••"
                    />
                  </div>
                  <button 
                    type="submit"
                    disabled={isLoggingIn}
                    className={`w-full bg-white text-[#764ba2] font-bold py-3 rounded-xl shadow-xl transition-all transform active:scale-95 hover:bg-white/90 ${isLoggingIn ? 'opacity-50 cursor-not-allowed' : ''}`}
                  >
                    {isLoggingIn ? 'Entrando...' : 'Entrar'}
                  </button>
                </form>
                <div className="mt-6 text-center space-y-2">
                  <p className="text-sm text-white/70">
                    Não tem conta? {' '}
                    <button onClick={() => setView('register')} className="text-white font-bold hover:underline">
                      Cadastre-se
                    </button>
                  </p>
                  <button 
                    onClick={() => setView('admin')} 
                    className="text-xs text-white/40 hover:text-white/60 transition-colors"
                  >
                    Área Administrativa
                  </button>
                </div>
              </div>
            </motion.div>
          )}

          {/* Register View */}
          {view === 'register' && (
            <motion.div
              key="register"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="max-w-md mx-auto"
            >
              <div className="bg-white/10 backdrop-blur-2xl p-8 rounded-[24px] shadow-2xl border border-white/20">
                <h2 className="text-2xl font-bold mb-6 text-center text-white">Crie sua conta</h2>
                <form onSubmit={handleRegister} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-white/80 mb-1">Nome Completo</label>
                    <input 
                      name="nome" 
                      type="text" 
                      required 
                      className="w-full px-4 py-3 rounded-xl bg-white/10 border border-white/20 text-white placeholder:text-white/40 focus:ring-2 focus:ring-white/30 outline-none transition-all"
                      placeholder="João Silva"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-white/80 mb-1">Email</label>
                    <input 
                      name="email" 
                      type="email" 
                      required 
                      className="w-full px-4 py-3 rounded-xl bg-white/10 border border-white/20 text-white placeholder:text-white/40 focus:ring-2 focus:ring-white/30 outline-none transition-all"
                      placeholder="seu@email.com"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-white/80 mb-1">Chave PIX (Opcional)</label>
                    <input 
                      name="pixKey" 
                      type="text" 
                      className="w-full px-4 py-3 rounded-xl bg-white/10 border border-white/20 text-white placeholder:text-white/40 focus:ring-2 focus:ring-white/30 outline-none transition-all"
                      placeholder="seu-pix-personalizado"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-white/80 mb-1">Senha</label>
                    <input 
                      name="senha" 
                      type="password" 
                      required 
                      className="w-full px-4 py-3 rounded-xl bg-white/10 border border-white/20 text-white placeholder:text-white/40 focus:ring-2 focus:ring-white/30 outline-none transition-all"
                      placeholder="••••••••"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-white/80 mb-1">Confirmar Senha</label>
                    <input 
                      name="confirmarSenha" 
                      type="password" 
                      required 
                      className="w-full px-4 py-3 rounded-xl bg-white/10 border border-white/20 text-white placeholder:text-white/40 focus:ring-2 focus:ring-white/30 outline-none transition-all"
                      placeholder="••••••••"
                    />
                  </div>
                  <button 
                    type="submit"
                    disabled={isRegistering}
                    className={`w-full bg-white text-[#764ba2] font-bold py-3 rounded-xl shadow-xl transition-all transform active:scale-95 hover:bg-white/90 ${isRegistering ? 'opacity-50 cursor-not-allowed' : ''}`}
                  >
                    {isRegistering ? 'Criando conta...' : 'Cadastrar'}
                  </button>
                </form>
                <p className="mt-6 text-center text-sm text-white/70">
                  Já tem conta? {' '}
                  <button onClick={() => setView('login')} className="text-white font-bold hover:underline">
                    Faça login
                  </button>
                </p>
              </div>
            </motion.div>
          )}

          {/* Dashboard View */}
          {view === 'dashboard' && (
            userData ? (
              <motion.div
                key="dashboard"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="space-y-6"
              >
                {/* Welcome Card & Navigation */}
                <div className="space-y-4">
                  <div className="bg-white/10 backdrop-blur-2xl p-6 rounded-[24px] border border-white/20 flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-xl">
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 bg-white/20 rounded-full flex items-center justify-center text-white cursor-pointer hover:bg-white/30 transition-all" onClick={() => setDashboardSection('main')}>
                        <User size={24} />
                      </div>
                      <div>
                        <p className="text-sm text-white/60 font-medium">Olá,</p>
                        <h2 className="text-xl font-bold text-white">{userData.nome}</h2>
                        <p className="text-xs text-white/50 font-mono mt-1">Sua chave PIX: <span className="text-white/80">{userData.pixKey}</span></p>
                      </div>
                    </div>
                    <div className="bg-white/15 p-4 rounded-xl border border-white/20">
                      <p className="text-xs text-white/60 font-bold uppercase tracking-wider mb-1">Saldo Disponível</p>
                      <p className="text-4xl font-black text-white">
                        R$ {userData.saldo.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                      </p>
                    </div>
                  </div>

                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-3">
                      <button 
                        onClick={() => setDashboardSection('main')}
                        className={`p-4 rounded-2xl border transition-all flex flex-col items-center gap-2 ${dashboardSection === 'main' ? 'bg-white text-[#764ba2] border-white' : 'bg-white/5 text-white border-white/10 hover:bg-white/10'}`}
                      >
                        <Send size={20} />
                        <span className="text-[10px] font-bold uppercase tracking-widest">Início</span>
                      </button>
                      <button 
                        onClick={() => setIsQrModalOpen(true)}
                        className={`p-4 rounded-2xl border transition-all flex flex-col items-center gap-2 bg-white/5 text-white border-white/10 hover:bg-white/10`}
                      >
                        <QrCode size={20} />
                        <span className="text-[10px] font-bold uppercase tracking-widest">Receber</span>
                      </button>
                      <button 
                        onClick={() => setDashboardSection('casino')}
                        className={`p-4 rounded-2xl border transition-all flex flex-col items-center gap-2 ${dashboardSection === 'casino' ? 'bg-orange-600 text-white border-orange-400 shadow-[0_0_15px_rgba(234,88,12,0.4)]' : 'bg-white/5 text-white border-white/10 hover:bg-white/10'}`}
                      >
                        <Dices size={20} />
                        <span className="text-[10px] font-bold uppercase tracking-widest">Cassino</span>
                      </button>
                      <button 
                        onClick={() => setDashboardSection('history')}
                        className={`p-4 rounded-2xl border transition-all flex flex-col items-center gap-2 ${dashboardSection === 'history' ? 'bg-white text-[#764ba2] border-white' : 'bg-white/5 text-white border-white/10 hover:bg-white/10'}`}
                      >
                        <History size={20} />
                        <span className="text-[10px] font-bold uppercase tracking-widest">Extrato</span>
                      </button>
                      <button 
                        onClick={() => setDashboardSection('cards')}
                        className={`p-4 rounded-2xl border transition-all flex flex-col items-center gap-2 ${dashboardSection === 'cards' ? 'bg-white text-[#764ba2] border-white' : 'bg-white/5 text-white border-white/10 hover:bg-white/10'}`}
                      >
                        <CreditCard size={20} />
                        <span className="text-[10px] font-bold uppercase tracking-widest">Cartões</span>
                      </button>
                      <button 
                        onClick={() => setDashboardSection('security')}
                        className={`p-4 rounded-2xl border transition-all flex flex-col items-center gap-2 ${dashboardSection === 'security' ? 'bg-white text-[#764ba2] border-white' : 'bg-white/5 text-white border-white/10 hover:bg-white/10'}`}
                      >
                        <Shield size={20} />
                        <span className="text-[10px] font-bold uppercase tracking-widest">Segurança</span>
                      </button>
                    </div>
                </div>

                <AnimatePresence mode="wait">
                  {/* MAIN SECTION (PIX) */}
                  {dashboardSection === 'main' && (
                    <motion.div
                      key="section-main"
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      className="space-y-6"
                    >
                      {/* PIX Form */}
                      <div className="bg-white/10 backdrop-blur-2xl p-8 rounded-[24px] border border-white/20 shadow-xl text-white">
                        <div className="flex items-center gap-3 mb-6">
                          <div className="p-2 bg-white text-[#764ba2] rounded-lg">
                            <Send size={20} />
                          </div>
                          <h3 className="text-xl font-bold">Enviar PIX</h3>
                        </div>
                        <form onSubmit={handlePix} className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div className="md:col-span-1">
                            <label className="block text-sm font-medium text-white/80 mb-1">Chave PIX do Destinatário</label>
                            <input 
                              name="destPixKey" 
                              type="text" 
                              required 
                              className="w-full px-4 py-3 rounded-xl bg-white/10 border border-white/20 text-white placeholder:text-white/40 focus:ring-2 focus:ring-white/30 outline-none transition-all"
                              placeholder="email ou chave personalizada"
                            />
                          </div>
                          <div className="md:col-span-1">
                            <label className="block text-sm font-medium text-white/80 mb-1">Valor (R$)</label>
                            <input 
                              name="valor" 
                              type="number" 
                              step="0.01"
                              required 
                              className="w-full px-4 py-3 rounded-xl bg-white/10 border border-white/20 text-white placeholder:text-white/40 focus:ring-2 focus:ring-white/30 outline-none transition-all"
                              placeholder="0,00"
                            />
                          </div>
                          <div className="md:col-span-2 flex gap-2">
                            <button 
                              type="submit"
                              className="flex-1 bg-white text-[#764ba2] font-bold py-4 rounded-xl shadow-xl transition-all transform active:scale-95 flex items-center justify-center gap-2 hover:bg-white/90"
                            >
                              <ArrowRightLeft size={20} />
                              Confirmar Transferência
                            </button>
                            <button 
                              type="button"
                              onClick={() => {
                                setNfcStep('start');
                                setIsNfcModalOpen(true);
                              }}
                              className="px-6 bg-white/20 text-white font-bold py-4 rounded-xl shadow-xl transition-all transform active:scale-95 flex items-center justify-center gap-2 hover:bg-white/30 border border-white/20"
                              title="Pagar por Aproximação"
                            >
                              <Zap size={20} />
                            </button>
                          </div>
                        </form>
                      </div>

                      {/* Your Info Card */}
                      <div className="bg-white/10 backdrop-blur-xl p-6 rounded-2xl border border-white/20 flex flex-col md:flex-row items-center justify-between gap-6">
                        <div className="flex items-center gap-4">
                          <div className="p-3 bg-white/10 rounded-xl text-white"><CheckCircle2 size={32} /></div>
                          <div>
                            <h4 className="font-bold text-lg">Sua chave PIX está ativa</h4>
                            <p className="text-sm text-white/60">Receba pagamentos instantâneos usando sua chave: <span className="text-white font-mono">{userData.pixKey}</span></p>
                          </div>
                        </div>
                        <form onSubmit={handleUpdatePixKey} className="flex gap-2 w-full md:w-auto">
                          <input 
                            name="newPixKey" 
                            type="text" 
                            placeholder="Mudar chave"
                            className="bg-white/5 border border-white/10 px-4 py-2 rounded-xl text-sm text-white outline-none focus:ring-2 focus:ring-white/30 flex-1"
                          />
                          <button type="submit" className="bg-white/10 hover:bg-white/20 border border-white/20 px-4 py-2 rounded-xl text-xs font-bold transition-all">Alterar</button>
                        </form>
                      </div>

                      {/* Recent Activities */}
                      <div className="bg-white/10 backdrop-blur-2xl p-6 rounded-[24px] border border-white/20 shadow-xl">
                        <div className="flex items-center justify-between mb-4">
                          <h3 className="font-bold flex items-center gap-2">
                            <History size={18} />
                            Transações Recentes
                          </h3>
                          <button onClick={() => setDashboardSection('history')} className="text-xs text-white/60 hover:text-white underline">Ver tudo</button>
                        </div>
                        <div className="space-y-3">
                          {transactions.slice(0, 3).map((tx) => {
                            const isSender = tx.senderUid === user?.uid;
                            return (
                              <div key={tx.id} className="flex items-center justify-between p-3 bg-white/5 rounded-xl border border-white/5">
                                <div className="flex items-center gap-3">
                                  <div className={`p-1.5 rounded-full ${isSender ? 'bg-red-500/20 text-red-300' : 'bg-green-500/20 text-green-300'}`}>
                                    {isSender ? <Send size={14} /> : <Plus size={14} />}
                                  </div>
                                  <div>
                                    <p className="text-sm font-bold truncate max-w-[150px]">{isSender ? `Para: ${tx.recipientName}` : `De: ${tx.senderName}`}</p>
                                    <p className="text-[10px] text-white/40">{tx.timestamp?.toDate ? tx.timestamp.toDate().toLocaleDateString('pt-BR') : 'Processando...'}</p>
                                  </div>
                                </div>
                                <div className={`text-sm font-bold ${isSender ? 'text-red-300' : 'text-green-300'}`}>
                                  {isSender ? '-' : '+'} R$ {tx.amount.toFixed(2)}
                                </div>
                              </div>
                            );
                          })}
                          {transactions.length === 0 && <p className="text-center py-4 text-white/30 italic text-sm">Nenhuma movimentação</p>}
                        </div>
                      </div>
                    </motion.div>
                  )}

                  {/* HISTORY SECTION */}
                  {dashboardSection === 'history' && (
                    <motion.div
                      key="section-history"
                      initial={{ opacity: 0, x: 20 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -20 }}
                      className="bg-white/10 backdrop-blur-2xl p-8 rounded-[24px] border border-white/20 shadow-xl"
                    >
                      <div className="flex items-center gap-3 mb-6">
                        <div className="p-2 bg-white text-[#764ba2] rounded-lg">
                          <History size={20} />
                        </div>
                        <h3 className="text-xl font-bold">Extrato Completo</h3>
                      </div>
                      
                      {transactions.length === 0 ? (
                        <div className="text-center py-20 text-white/40 italic">
                          <History size={48} className="mx-auto mb-4 opacity-20" />
                          <p>Você ainda não realizou transações.</p>
                        </div>
                      ) : (
                        <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-2 custom-scrollbar">
                          {transactions.map((tx) => {
                            const isSender = tx.senderUid === user?.uid;
                            return (
                              <div key={tx.id} className="flex items-center justify-between p-4 bg-white/5 rounded-xl border border-white/10 hover:bg-white/10 transition-all">
                                <div className="flex items-center gap-4">
                                  <div className={`p-2 rounded-full ${isSender ? 'bg-red-500/20 text-red-300' : 'bg-green-500/20 text-green-300'}`}>
                                    {isSender ? <Send size={18} /> : <Plus size={18} />}
                                  </div>
                                  <div>
                                    <p className="font-bold">
                                      {isSender ? `PIX Enviado para ${tx.recipientName}` : `PIX Recebido de ${tx.senderName}`}
                                    </p>
                                    <p className="text-xs text-white/50">
                                      {tx.timestamp?.toDate ? tx.timestamp.toDate().toLocaleString('pt-BR') : 'Processando...'}
                                    </p>
                                  </div>
                                </div>
                                <div className={`font-bold text-lg ${isSender ? 'text-red-300' : 'text-green-300'}`}>
                                  {isSender ? '-' : '+'} R$ {tx.amount.toFixed(2)}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </motion.div>
                  )}

                  {/* CARDS SECTION */}
                  {dashboardSection === 'cards' && (
                    <motion.div
                      key="section-cards"
                      initial={{ opacity: 0, x: 20 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -20 }}
                      className="space-y-6"
                    >
                      <div className="bg-white/10 backdrop-blur-2xl p-8 rounded-[24px] border border-white/20 shadow-xl">
                        <div className="flex items-center justify-between mb-8">
                          <div className="flex items-center gap-3">
                            <div className="p-2 bg-white text-[#764ba2] rounded-lg">
                              <CreditCard size={20} />
                            </div>
                            <h3 className="text-xl font-bold">Seus Cartões</h3>
                          </div>
                          <button 
                            onClick={handleCreateCard}
                            className="bg-white text-[#764ba2] px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider flex items-center gap-2 hover:bg-white/90 transition-all shadow-lg active:scale-95"
                          >
                            <Plus size={16} />
                            Gerar Cartão Virtual
                          </button>
                        </div>

                        {cards.length === 0 ? (
                          <div className="text-center py-16 text-white/40 bg-white/5 rounded-3xl border border-dashed border-white/10">
                            <CreditCard size={48} className="mx-auto mb-4 opacity-20" />
                            <p>Você não possui cartões virtuais gerados.</p>
                            <p className="text-xs mt-2">Clique no botão acima para criar o seu primeiro!</p>
                          </div>
                        ) : (
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            {cards.map((card) => (
                              <motion.div 
                                initial={{ scale: 0.9, opacity: 0 }}
                                animate={{ scale: 1, opacity: 1 }}
                                key={card.id} 
                                className={`relative h-56 rounded-2xl p-6 shadow-2xl flex flex-col justify-between overflow-hidden group border border-white/20 ${card.status === 'blocked' ? 'grayscale opacity-60' : ''}`}
                                style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.1) 0%, rgba(255,255,255,0.05) 100%)' }}
                              >
                                {/* Decorative elements */}
                                <div className="absolute -top-10 -right-10 w-40 h-40 bg-white/10 rounded-full blur-3xl group-hover:bg-white/20 transition-all"></div>
                                <div className="absolute -bottom-10 -left-10 w-40 h-40 bg-purple-500/10 rounded-full blur-3xl group-hover:bg-purple-500/20 transition-all"></div>

                                <div className="flex justify-between items-start">
                                  <div className="flex flex-col gap-1">
                                    <p className="text-[10px] font-black uppercase tracking-[0.2em] text-white/60">FrontBank Platinum</p>
                                    <div className="w-10 h-8 bg-yellow-500/80 rounded-md shadow-inner flex items-center justify-center">
                                      <div className="w-6 h-4 border border-black/20 rounded-sm"></div>
                                    </div>
                                  </div>
                                  <div className="flex flex-col items-end gap-2">
                                    {card.status === 'active' && (
                                      <button 
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setSelectedNfcCard(card.id);
                                          setNfcStep('start');
                                          setIsNfcModalOpen(true);
                                        }}
                                        className="bg-white/10 hover:bg-white text-[#764ba2] hover:text-black p-1.5 rounded-lg transition-all shadow-lg active:scale-95 flex items-center gap-1.5 text-[8px] font-black uppercase"
                                      >
                                        <Zap size={12} /> NFC
                                      </button>
                                    )}
                                    <button 
                                      onClick={() => toggleCardStatus(card.id, card.status)}
                                      className={`text-[10px] px-3 py-1 rounded-full font-bold uppercase tracking-wider border transition-all ${card.status === 'active' ? 'bg-green-500/20 border-green-500/40 text-green-300 hover:bg-red-500/20 hover:border-red-500/40 hover:text-red-300' : 'bg-red-500/20 border-red-500/40 text-red-300 hover:bg-green-500/20 hover:border-green-500/40 hover:text-green-300'}`}
                                    >
                                      {card.status === 'active' ? 'Bloquear' : 'Desbloquear'}
                                    </button>
                                    <p className="text-lg font-black italic opacity-40">Virtual</p>
                                  </div>
                                </div>

                                <div>
                                  <p className="text-xl font-mono tracking-widest text-shadow mb-4">{card.cardNumber}</p>
                                  <div className="flex gap-8 text-[10px]">
                                    <div>
                                      <p className="text-white/40 uppercase tracking-tighter mb-0.5">Vencimento</p>
                                      <p className="font-bold tracking-widest">{card.expiry}</p>
                                    </div>
                                    <div>
                                      <p className="text-white/40 uppercase tracking-tighter mb-0.5">CVV</p>
                                      <p className="font-bold tracking-widest">{card.cvv}</p>
                                    </div>
                                  </div>
                                </div>

                                <div className="flex justify-between items-end">
                                  <p className="text-xs font-bold uppercase tracking-widest">{card.holderName}</p>
                                  <div className="flex gap-1">
                                    <div className="w-6 h-6 bg-red-500/80 rounded-full"></div>
                                    <div className="w-6 h-6 bg-yellow-500/80 rounded-full -ml-3"></div>
                                  </div>
                                </div>
                              </motion.div>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="bg-white/5 p-4 rounded-xl border border-white/10 text-white/50 text-xs flex items-center gap-3">
                        <AlertCircle size={16} />
                        <p>Os cartões virtuais são para uso exclusivo em compras online. Você pode gerar quantos precisar e bloqueá-los a qualquer momento.</p>
                      </div>
                    </motion.div>
                  )}

                  {/* CASINO & INVESTMENTS SECTION */}
                  {dashboardSection === 'casino' && (
                    <motion.div
                      key="section-casino"
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -20 }}
                      className="space-y-6"
                    >
                      <div className="flex bg-black/60 p-2 rounded-2xl border border-white/10 gap-2 mb-8 overflow-x-auto no-scrollbar">
                        <button 
                          onClick={() => setCasinoSubTab('lion')}
                          className={`flex-1 min-w-[100px] py-3 rounded-xl font-black text-xs uppercase tracking-[0.2em] transition-all flex items-center justify-center gap-2 ${casinoSubTab === 'lion' ? 'bg-orange-600 text-white shadow-lg' : 'text-white/40 hover:bg-white/5'}`}
                        >
                          <Zap size={14} /> Slots
                        </button>
                        <button 
                          onClick={() => setCasinoSubTab('crash')}
                          className={`flex-1 min-w-[100px] py-3 rounded-xl font-black text-xs uppercase tracking-[0.2em] transition-all flex items-center justify-center gap-2 ${casinoSubTab === 'crash' ? 'bg-orange-600 text-white shadow-lg' : 'text-white/40 hover:bg-white/5'}`}
                        >
                          <TrendingUp size={14} /> Crash
                        </button>
                        <button 
                          onClick={() => setCasinoSubTab('double')}
                          className={`flex-1 min-w-[100px] py-3 rounded-xl font-black text-xs uppercase tracking-[0.2em] transition-all flex items-center justify-center gap-2 ${casinoSubTab === 'double' ? 'bg-orange-600 text-white shadow-lg' : 'text-white/40 hover:bg-white/5'}`}
                        >
                          <Trophy size={14} /> Double
                        </button>
                        <button 
                          onClick={() => setCasinoSubTab('roulette')}
                          className={`flex-1 min-w-[100px] py-3 rounded-xl font-black text-xs uppercase tracking-[0.2em] transition-all flex items-center justify-center gap-2 ${casinoSubTab === 'roulette' ? 'bg-orange-600 text-white shadow-lg' : 'text-white/40 hover:bg-white/5'}`}
                        >
                          <CircleDot size={14} /> Roulette
                        </button>
                        <button 
                          onClick={() => setCasinoSubTab('bitcoin')}
                          className={`flex-1 min-w-[100px] py-3 rounded-xl font-black text-xs uppercase tracking-[0.2em] transition-all flex items-center justify-center gap-2 ${casinoSubTab === 'bitcoin' ? 'bg-orange-600 text-white shadow-lg' : 'text-white/40 hover:bg-white/5'}`}
                        >
                          <Bitcoin size={14} /> Crypto
                        </button>
                      </div>

                      {casinoSubTab === 'bitcoin' ? (
                        <div className="bg-[#0a0a0a]/80 backdrop-blur-3xl p-8 rounded-[40px] border border-orange-500/30 shadow-[0_0_80px_rgba(249,115,22,0.1)] overflow-hidden relative">
                           <div className="absolute top-0 right-0 w-96 h-96 bg-orange-500/5 rounded-full blur-[100px] pointer-events-none"></div>
                           
                           <div className="relative z-10">
                            <div className="flex bg-black/40 p-1 rounded-xl mb-8 w-fit gap-1">
                              {['BTC', 'ETH', 'SOL'].map((token) => (
                                <button 
                                  key={token}
                                  onClick={() => setInvestCrypto(token as any)}
                                  className={`px-4 py-2 rounded-lg text-[10px] font-black tracking-widest uppercase transition-all ${investCrypto === token ? 'bg-orange-500 text-black' : 'text-white/40 hover:bg-white/5'}`}
                                >
                                  {token}
                                </button>
                              ))}
                            </div>

                            <div className="flex flex-col md:flex-row md:items-center justify-between gap-8 mb-12">
                              <div className="flex items-center gap-5">
                                <div className="w-20 h-20 bg-orange-500/10 border border-orange-500/50 flex items-center justify-center rounded-[24px] shadow-[0_0_30px_rgba(249,115,22,0.2)] transform -rotate-3">
                                  {investCrypto === 'BTC' ? <Bitcoin size={40} className="text-orange-500" /> : investCrypto === 'ETH' ? (
                                    <svg viewBox="0 0 24 24" className="w-10 h-10 text-orange-500 fill-current">
                                      <path d="M12 2L4.5 14.5 12 19l7.5-4.5L12 2zM12 21l7.5-4.5L12 13 4.5 16.5 12 21z" />
                                    </svg>
                                  ) : (
                                    <svg viewBox="0 0 24 24" className="w-10 h-10 text-orange-500 fill-current">
                                      <path d="M4.5 4.5h15L15 9H0L4.5 4.5zm0 15h15l-4.5-4.5H0l4.5 4.5zm15-7.5H4.5L9 7.5h15l-4.5 4.5z" />
                                    </svg>
                                  )}
                                </div>
                                <div>
                                  <h3 className="text-3xl font-black text-white italic uppercase tracking-tighter">Market {investCrypto}</h3>
                                  <div className="flex items-center gap-2">
                                    <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse shadow-[0_0_8px_rgba(34,197,94,1)]"></div>
                                    <p className="text-orange-500/60 text-[10px] font-black tracking-widest uppercase">Operação Direta</p>
                                  </div>
                                </div>
                              </div>
                              
                              <div className="text-right">
                                <p className="text-[10px] font-black text-white/40 uppercase tracking-[0.3em] mb-2">Preço de Mercado</p>
                                <div className="flex items-center justify-end gap-4">
                                  <h4 className="text-5xl font-black text-white tracking-tighter tabular-nums">
                                    {cryptoPrice ? `R$ ${cryptoPrice.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : 'CARREGANDO...'}
                                  </h4>
                                  {cryptoChange !== null && (
                                    <div className={`px-3 py-1.5 rounded-lg text-xs font-black flex items-center gap-1.5 ${cryptoChange >= 0 ? 'bg-green-500/10 text-green-400 border border-green-500/20' : 'bg-red-500/10 text-red-500 border border-red-500/20'}`}>
                                      {cryptoChange >= 0 ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
                                      {Math.abs(cryptoChange).toFixed(2)}%
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>

                            <div className="bg-black/40 h-48 rounded-3xl mb-12 border border-white/5 relative flex items-end p-4 overflow-hidden shadow-inner">
                              <svg className="w-full h-full opacity-60" viewBox="0 0 100 100" preserveAspectRatio="none">
                                <path 
                                  d={`M 0 100 ${cryptoHistory.map((p, i) => `L ${(i / (cryptoHistory.length - 1)) * 100} ${100 - ((p - Math.min(...cryptoHistory)) / (Math.max(...cryptoHistory) - Math.min(...cryptoHistory) || 1)) * 80}`).join(' ')} L 100 100 Z`}
                                  fill="url(#gradient-crypto)"
                                />
                                <path 
                                  d={`M 0 ${100 - ((cryptoHistory[0] - Math.min(...cryptoHistory)) / (Math.max(...cryptoHistory) - Math.min(...cryptoHistory) || 1)) * 80} ${cryptoHistory.map((p, i) => `L ${(i / (cryptoHistory.length - 1)) * 100} ${100 - ((p - Math.min(...cryptoHistory)) / (Math.max(...cryptoHistory) - Math.min(...cryptoHistory) || 1)) * 80}`).join(' ')}`}
                                  fill="none"
                                  stroke="#f39c12"
                                  strokeWidth="2"
                                />
                                <defs>
                                  <linearGradient id="gradient-crypto" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="0%" stopColor="#f39c12" stopOpacity="0.4" />
                                    <stop offset="100%" stopColor="#f39c12" stopOpacity="0" />
                                  </linearGradient>
                                </defs>
                              </svg>
                            </div>

                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                                <div className="space-y-6">
                                  <div className="bg-white/5 p-8 rounded-3xl border border-white/10">
                                    <p className="text-[10px] font-black uppercase tracking-[0.3em] text-white/40 mb-4">Sua Carteira</p>
                                    <div className="flex items-center gap-4">
                                      <div className="w-14 h-14 bg-orange-500/10 text-orange-500 rounded-2xl flex items-center justify-center border border-orange-500/20">
                                        <Bitcoin size={28} />
                                      </div>
                                      <div>
                                        <p className="text-3xl font-black text-white">
                                          {investCrypto === 'BTC' ? (userData?.btcBalance || 0).toFixed(8) : investCrypto === 'ETH' ? (userData?.ethBalance || 0).toFixed(6) : (userData?.solBalance || 0).toFixed(4)} {investCrypto}
                                        </p>
                                        <p className="text-xs text-white/40 font-bold uppercase tracking-widest mt-1">
                                          ~ R$ {((investCrypto === 'BTC' ? (userData?.btcBalance || 0) : investCrypto === 'ETH' ? (userData?.ethBalance || 0) : (userData?.solBalance || 0)) * (cryptoPrice || 0)).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                                        </p>
                                      </div>
                                    </div>
                                  </div>
                                  <div className="flex gap-4">
                                    <button onClick={() => setInvestAction('buy')} className={`flex-1 py-5 rounded-[24px] font-black text-sm uppercase tracking-widest transition-all ${investAction === 'buy' ? 'bg-orange-500 text-black shadow-[0_10px_30px_rgba(249,115,22,0.3)]' : 'bg-white/5 text-white border border-white/10 hover:bg-white/10'}`}>Comprar</button>
                                    <button onClick={() => setInvestAction('sell')} className={`flex-1 py-5 rounded-[24px] font-black text-sm uppercase tracking-widest transition-all ${investAction === 'sell' ? 'bg-red-600 text-white shadow-[0_10px_30px_rgba(220,38,38,0.3)]' : 'bg-white/5 text-white border border-white/10 hover:bg-white/10'}`}>Vender</button>
                                  </div>
                                </div>
                                <form onSubmit={handleBitcoinTrade} className="bg-white/5 p-10 rounded-[40px] border border-white/10 space-y-8">
                                   <div className="space-y-4">
                                     <div className="flex items-center justify-between px-2">
                                       <label className="text-[10px] font-black text-white/40 uppercase tracking-[0.3em] block">
                                         {investAction === 'buy' ? 'Quanto quer investir?' : 'Quanto quer resgatar?'}
                                       </label>
                                       {investAmount && cryptoPrice && (
                                         <p className="text-[10px] font-black text-orange-500 uppercase tracking-widest animate-pulse">
                                           ≈ {(parseFloat(investAmount) / cryptoPrice).toFixed(8)} {investCrypto}
                                         </p>
                                       )}
                                     </div>
                                     <div className="relative">
                                       <input 
                                         type="number" 
                                         value={investAmount} 
                                         onChange={(e) => setInvestAmount(e.target.value)} 
                                         placeholder="0.00" 
                                         className="w-full bg-black/60 border-2 border-white/10 rounded-[28px] py-6 px-8 text-3xl font-black text-white outline-none focus:border-orange-500 transition-all placeholder:text-white/5" 
                                       />
                                       <span className="absolute right-8 top-1/2 -translate-y-1/2 font-black text-orange-500/40 text-xl">BRL</span>
                                     </div>
                                   </div>
                                  <button type="submit" className={`w-full py-6 rounded-[28px] font-black text-xl uppercase tracking-[0.2em] transition-all transform active:scale-95 shadow-2xl ${investAction === 'buy' ? 'bg-orange-500 text-black hover:bg-orange-400' : 'bg-red-600 text-white hover:bg-red-500'}`}>
                                    {isInvesting ? 'PROCESSANDO...' : 'EXECUTAR ORDEM'}
                                  </button>
                                </form>
                            </div>
                           </div>
                        </div>
                      ) : casinoSubTab === 'roulette' ? (
                        <div className="bg-[#0a0a0a]/80 backdrop-blur-3xl p-10 rounded-[40px] border border-white/5 shadow-2xl relative overflow-hidden">
                          <div className="relative z-10">
                            <div className="text-center mb-10">
                              <h3 className="text-4xl font-black text-white italic uppercase tracking-tighter mb-4">LION <span className="text-orange-500">ROULETTE</span></h3>
                              <div className="flex justify-center gap-2 overflow-x-auto no-scrollbar py-2">
                                {rouletteHistory.map((res, i) => {
                                  const redNumbers = [1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36];
                                  const color = res === 0 ? 'bg-green-600' : (redNumbers.includes(res) ? 'bg-red-600' : 'bg-black');
                                  return (
                                    <div key={i} className={`w-10 h-10 rounded-xl flex items-center justify-center font-black text-white text-sm border border-white/10 ${color}`}>
                                      {res}
                                    </div>
                                  );
                                })}
                              </div>
                            </div>

                            <div className="bg-black/60 p-8 rounded-[40px] border-4 border-white/5 mb-10 relative overflow-hidden flex flex-col items-center">
                              <motion.div 
                                animate={isRouletteSpinning ? { rotate: 360 * 5 } : { rotate: 0 }}
                                transition={{ duration: 3, ease: "easeOut" }}
                                className="w-48 h-48 rounded-full border-8 border-orange-600/20 relative flex items-center justify-center"
                              >
                                {rouletteResult !== null && (
                                  <motion.div 
                                    initial={{ scale: 0 }}
                                    animate={{ scale: 1 }}
                                    className={`w-24 h-24 rounded-full flex items-center justify-center text-4xl font-black text-white border-4 border-white/20 shadow-2xl
                                      ${rouletteResult === 0 ? 'bg-green-600' : ([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36].includes(rouletteResult) ? 'bg-red-600' : 'bg-black')}
                                    `}
                                  >
                                    {rouletteResult}
                                  </motion.div>
                                )}
                                {!isRouletteSpinning && rouletteResult === null && <CircleDot size={64} className="text-orange-500/20" />}
                              </motion.div>
                              <div className="absolute top-0 w-1 h-12 bg-white shadow-[0_0_15px_white] z-10"></div>
                            </div>

                            <div className="grid grid-cols-3 gap-3 mb-8">
                                <button onClick={() => setRouletteSelection('red')} className={`py-6 rounded-2xl border-4 transition-all flex flex-col items-center gap-2 ${rouletteSelection === 'red' ? 'bg-red-600 border-white shadow-xl' : 'bg-red-600/40 border-white/10'}`}>
                                  <span className="font-black text-white text-[10px] tracking-widest">RED</span>
                                  <span className="font-bold text-white text-xs opacity-60">2x</span>
                                </button>
                                <button onClick={() => setRouletteSelection('green')} className={`py-6 rounded-2xl border-4 transition-all flex flex-col items-center gap-2 ${rouletteSelection === 'green' ? 'bg-green-600 border-white shadow-xl' : 'bg-green-600/40 border-white/10'}`}>
                                  <span className="font-black text-white text-[10px] tracking-widest">ZERO</span>
                                  <span className="font-bold text-white text-xs opacity-60">35x</span>
                                </button>
                                <button onClick={() => setRouletteSelection('black')} className={`py-6 rounded-2xl border-4 transition-all flex flex-col items-center gap-2 ${rouletteSelection === 'black' ? 'bg-black border-white shadow-xl' : 'bg-black/40 border-white/10'}`}>
                                  <span className="font-black text-white text-[10px] tracking-widest">BLACK</span>
                                  <span className="font-bold text-white text-xs opacity-60">2x</span>
                                </button>
                            </div>

                            <div className="grid grid-cols-6 gap-2 mb-8 max-h-32 overflow-y-auto p-2 bg-black/40 rounded-2xl no-scrollbar">
                                {[...Array(37)].map((_, i) => (
                                  <button 
                                    key={i} 
                                    onClick={() => setRouletteSelection(i)}
                                    className={`py-2 rounded-lg font-black text-xs transition-all border ${rouletteSelection === i ? 'bg-orange-500 text-black border-white' : 'bg-white/5 text-white/40 border-white/5'}`}
                                  >
                                    {i}
                                  </button>
                                ))}
                            </div>

                            <div className="bg-black/40 p-8 rounded-[32px] border border-white/5 space-y-6">
                              <input 
                                type="number" 
                                value={rouletteBetAmount} 
                                onChange={(e) => setRouletteBetAmount(e.target.value)}
                                className="w-full bg-transparent text-center text-4xl font-black text-white outline-none" 
                                placeholder="0.00" 
                              />
                              <button 
                                onClick={handleRouletteSpin}
                                disabled={isRouletteSpinning}
                                className={`w-full py-6 rounded-[28px] font-black text-2xl uppercase italic tracking-tighter transition-all ${isRouletteSpinning ? 'bg-white/5 text-white/20' : 'bg-orange-600 text-white shadow-lg'}`}
                              >
                                {isRouletteSpinning ? 'GIRANDO...' : 'APOSTAR'}
                              </button>
                            </div>
                          </div>
                        </div>
                      ) : casinoSubTab === 'crash' ? (
                        <div className="bg-[#0a0a0a]/80 backdrop-blur-3xl p-10 rounded-[40px] border-4 border-orange-600/30 shadow-[0_0_100px_rgba(249,115,22,0.1)] relative overflow-hidden">
                          <div className="absolute top-0 left-0 w-full h-full bg-[radial-gradient(circle_at_top_right,_rgba(249,115,22,0.05)_0%,_transparent_60%)]"></div>
                          
                          <div className="relative z-10 flex flex-col items-center">
                            <div className="flex items-center gap-4 mb-12">
                              <div className="w-16 h-16 bg-white/5 rounded-2xl flex items-center justify-center border border-white/10 shadow-xl">
                                <TrendingUp size={32} className="text-orange-500" />
                              </div>
                              <div>
                                <h3 className="text-4xl font-black text-white italic uppercase tracking-tighter">LION <span className="text-orange-500">CRASH</span></h3>
                                <p className="text-white/30 text-[10px] font-black uppercase tracking-[0.3em]">Decolagem Alpha</p>
                              </div>
                            </div>

                            <div className="w-full aspect-video bg-black/60 rounded-[48px] border-4 border-white/5 mb-12 flex flex-col items-center justify-center relative overflow-hidden shadow-2xl">
                                <div className="absolute inset-0 opacity-20 pointer-events-none">
                                  <div className="absolute bottom-0 left-0 w-full h-[1px] bg-white/20"></div>
                                  <div className="absolute bottom-0 left-0 w-[1px] h-full bg-white/20"></div>
                                  {[...Array(10)].map((_, i) => (
                                    <div key={i} className="absolute bottom-0 w-full h-[1px] bg-white/5" style={{ bottom: `${i * 10}%` }}></div>
                                  ))}
                                </div>

                                <motion.div 
                                  animate={crashStatus === 'running' ? { scale: [1, 1.1, 1] } : {}}
                                  transition={{ repeat: Infinity, duration: 1 }}
                                  className={`text-8xl md:text-9xl font-black italic tracking-tighter tabular-nums ${crashStatus === 'crashed' ? 'text-red-600' : 'text-white'}`}
                                >
                                  {crashMultiplier.toFixed(2)}x
                                </motion.div>
                                
                                {crashStatus === 'crashed' && (
                                  <motion.div initial={{ opacity: 0, scale: 0.5 }} animate={{ opacity: 1, scale: 1 }} className="mt-4 px-6 py-2 bg-red-600 rounded-full text-white font-black uppercase text-xs tracking-widest">
                                    CABOOM!
                                  </motion.div>
                                )}

                                {crashStatus === 'running' && (
                                  <div className="absolute bottom-8 right-12 flex items-center gap-3">
                                    <div className="w-3 h-3 bg-green-500 rounded-full animate-ping"></div>
                                    <span className="text-[10px] font-black text-white/40 uppercase tracking-[0.2em]">SISTEMA ATIVO</span>
                                  </div>
                                )}
                            </div>

                            <div className="w-full max-w-sm space-y-6">
                              <div className="bg-black/40 p-8 rounded-[32px] border border-white/5 space-y-6">
                                <div>
                                  <label className="text-[10px] font-black text-white/40 uppercase tracking-[0.3em] block text-center mb-4">Valor da Decolagem</label>
                                  <div className="relative">
                                    <input 
                                      type="number" 
                                      value={crashBet} 
                                      onChange={(e) => setCrashBet(e.target.value)}
                                      disabled={crashStatus === 'running'}
                                      className="w-full bg-transparent text-center text-4xl font-black text-white outline-none placeholder:text-white/5" 
                                      placeholder="0.00"
                                    />
                                    <div className="absolute right-0 top-1/2 -translate-y-1/2 flex flex-col gap-1">
                                      <button onClick={() => setCrashBet(prev => (parseFloat(prev || '0') + 10).toString())} className="text-orange-500 hover:text-white transition-colors" disabled={crashStatus === 'running'}><ArrowUpRight size={16}/></button>
                                      <button onClick={() => setCrashBet(prev => (Math.max(0, parseFloat(prev || '0') - 10)).toString())} className="text-orange-500 hover:text-white transition-colors" disabled={crashStatus === 'running'}><ArrowDownRight size={16}/></button>
                                    </div>
                                  </div>
                                </div>
                              </div>

                              {crashStatus === 'running' && !hasCashedOut ? (
                                <button 
                                  onClick={cashOutCrash}
                                  className="w-full py-8 bg-green-600 text-white rounded-[32px] font-black text-2xl uppercase italic tracking-tighter shadow-[0_20px_50px_rgba(22,163,74,0.3)] hover:scale-105 active:scale-95 transition-all"
                                >
                                  RESGATAR R$ {(parseFloat(crashBet || '0') * crashMultiplier).toFixed(2)}
                                </button>
                              ) : (
                                <button 
                                  onClick={startCrashGame}
                                  disabled={crashStatus === 'running'}
                                  className={`w-full py-8 rounded-[32px] font-black text-2xl uppercase italic tracking-tighter shadow-2xl transition-all active:scale-95 ${crashStatus === 'running' ? 'bg-white/5 text-white/20' : 'bg-orange-600 text-white hover:shadow-orange-600/40'}`}
                                >
                                  {crashStatus === 'running' ? 'AGUARDE...' : 'DECOLAR'}
                                </button>
                              )}
                              
                              <p className="text-[10px] text-center text-white/20 font-bold uppercase tracking-widest">Saldo: R$ {userData?.saldo.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
                            </div>
                          </div>
                        </div>
                      ) : casinoSubTab === 'double' ? (
                        <div className="bg-[#0a0a0a]/80 backdrop-blur-3xl p-10 rounded-[40px] border border-white/5 shadow-2xl relative overflow-hidden">
                          <div className="relative z-10">
                            <div className="text-center mb-12">
                              <h3 className="text-4xl font-black text-white italic uppercase tracking-tighter mb-2">LION <span className="text-orange-500">DOUBLE</span></h3>
                              <div className="flex justify-center gap-2">
                                {doubleHistory.map((res, i) => (
                                  <div key={i} className={`w-8 h-8 rounded-lg border border-white/10 ${res === 'orange' ? 'bg-orange-600' : res === 'black' ? 'bg-black' : 'bg-yellow-500 animate-pulse'}`}></div>
                                ))}
                              </div>
                            </div>

                            <div className="bg-black/60 p-10 rounded-[48px] border-4 border-white/5 mb-12 relative overflow-hidden">
                              <div className="flex gap-4 justify-center items-center py-10">
                                {['black', 'orange', 'gold', 'orange', 'black'].map((c, i) => (
                                  <motion.div 
                                    key={i}
                                    animate={isDoubleSpinning ? { x: [0, -1000, 0] } : {}}
                                    transition={{ duration: 2, ease: "easeOut" }}
                                    className={`w-24 h-24 md:w-32 md:h-32 rounded-[24px] shadow-2xl flex items-center justify-center border-4 border-white/10 ${c === 'orange' ? 'bg-orange-600' : c === 'black' ? 'bg-black' : 'bg-yellow-500'}`}
                                  >
                                    {c === 'gold' && <Trophy size={40} className="text-black" />}
                                  </motion.div>
                                ))}
                              </div>
                              <div className="absolute top-0 left-1/2 -translate-x-1/2 w-1 h-full bg-orange-500 shadow-[0_0_20px_white] z-20"></div>
                            </div>

                            <div className="grid grid-cols-3 gap-4 mb-10">
                              <button onClick={() => setDoubleColor('black')} className={`p-6 rounded-3xl border-4 transition-all flex flex-col items-center gap-3 ${doubleColor === 'black' ? 'bg-black border-white shadow-2xl' : 'bg-black/40 border-white/10'}`}>
                                <div className="w-10 h-10 bg-black border border-white/20 rounded-full"></div>
                                <span className="font-black text-white italic text-xs">2.00x</span>
                              </button>
                              <button onClick={() => setDoubleColor('orange')} className={`p-6 rounded-3xl border-4 transition-all flex flex-col items-center gap-3 ${doubleColor === 'orange' ? 'bg-orange-600 border-white shadow-2xl' : 'bg-orange-600/40 border-white/10'}`}>
                                <div className="w-10 h-10 bg-orange-600 border border-white/20 rounded-full"></div>
                                <span className="font-black text-white italic text-xs">2.00x</span>
                              </button>
                              <button onClick={() => setDoubleColor('gold')} className={`p-6 rounded-3xl border-4 transition-all flex flex-col items-center gap-3 ${doubleColor === 'gold' ? 'bg-yellow-500 border-white shadow-2xl' : 'bg-yellow-500/40 border-white/10'}`}>
                                <div className="w-10 h-10 bg-yellow-500 border border-white/20 rounded-full animate-pulse"></div>
                                <span className="font-black text-black italic text-xs font-black">14.00x</span>
                              </button>
                            </div>

                            <div className="bg-black/40 p-8 rounded-[32px] border border-white/5 space-y-6">
                              <input 
                                type="number" 
                                value={doubleBetAmount} 
                                onChange={(e) => setDoubleBetAmount(e.target.value)}
                                className="w-full bg-transparent text-center text-4xl font-black text-white outline-none" 
                                placeholder="0.00" 
                              />
                              <button 
                                onClick={handleDoubleSpin}
                                disabled={isDoubleSpinning}
                                className={`w-full py-6 rounded-[28px] font-black text-2xl uppercase italic tracking-tighter transition-all ${isDoubleSpinning ? 'bg-white/5 text-white/20' : 'bg-orange-600 text-white shadow-lg'}`}
                              >
                                {isDoubleSpinning ? 'SORTEANDO...' : 'APOSTAR'}
                              </button>
                            </div>
                          </div>
                        </div>
                      ) : (
                        /* LION LUCK UI */
                        <div className="bg-[#0f0f1a] backdrop-blur-3xl p-8 rounded-[32px] border-4 border-orange-600 shadow-[0_0_100px_rgba(234,88,12,0.2)] overflow-hidden relative">
                          <div className="absolute top-0 left-0 w-full h-full bg-[radial-gradient(circle_at_center,_rgba(234,88,12,0.1)_0%,_transparent_70%)]"></div>
                          
                          <div className="relative z-10 flex flex-col items-center">
                            <div className="bg-black/60 px-6 py-2 rounded-full border border-orange-500/30 mb-8 animate-pulse">
                              <p className="text-[10px] font-black text-orange-500 uppercase tracking-[0.4em]">Jackpot Acumulado: R$ 1.500.230,40</p>
                            </div>

                            <div className="flex items-center gap-6 mb-10">
                                <div className="w-24 h-24 bg-orange-600 rounded-[32px] flex items-center justify-center shadow-[0_0_30px_rgba(234,88,12,0.5)] transform -rotate-12 border-4 border-black">
                                  <svg viewBox="0 0 24 24" className="w-16 h-16 text-black fill-none stroke-current stroke-2">
                                    <path d="M12 4C7.58 4 4 7.58 4 12s3.58 8 8 8 8-3.58 8-8-3.58-8-8-8zm0 14.5c-3.59 0-6.5-2.91-6.5-6.5S8.41 5.5 12 5.5s6.5 2.91 6.5 6.5-2.91 6.5-6.5 6.5z" />
                                    <path d="M12 8c-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4-1.79-4-4-4zm0 6.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" />
                                    <path d="M10.5 11c-.28 0-.5.22-.5.5s.22.5.5.5.5-.22.5-.5-.22-.5-.5-.5zm3 0c-.28 0-.5.22-.5.5s.22.5.5.5.5-.22.5-.5-.22-.5-.5-.5z" />
                                    <path d="M12 13v2m-1-1h2" />
                                  </svg>
                                </div>
                                <div className="text-center md:text-left">
                                  <h3 className="text-6xl font-black text-white italic tracking-tighter uppercase leading-none">LION <span className="text-orange-600">LUCK</span></h3>
                                  <p className="text-orange-500/60 font-black tracking-widest text-xs mt-2 uppercase">A Sorte do Rei da Selva</p>
                                </div>
                            </div>

                            {/* Slot Machine Display */}
                            <div className="w-full max-w-lg grid grid-cols-3 gap-4 mb-12 bg-black/80 p-6 rounded-[40px] border-8 border-orange-700 shadow-inner">
                              {slotResult.map((sym, i) => (
                                <motion.div 
                                  key={i}
                                  animate={isSpinning ? { y: [0, -20, 0] } : {}}
                                  transition={{ repeat: Infinity, duration: 0.1 }}
                                  className="aspect-square bg-gradient-to-b from-white/10 to-white/5 rounded-3xl flex items-center justify-center shadow-2xl border border-white/5"
                                >
                                  {renderSlotSymbol(sym)}
                                </motion.div>
                              ))}
                            </div>

                            <div className="w-full max-w-sm space-y-6">
                              <div className="text-center">
                                <p className={`text-2xl font-black italic tracking-widest mb-4 transition-colors ${isSpinning ? 'text-white/20' : 'text-orange-500 uppercase'}`}>
                                  {gameMessage}
                                </p>
                              </div>

                              <div className="bg-black/40 p-6 rounded-3xl border border-white/5">
                                <label className="block text-[10px] font-bold text-white/40 uppercase tracking-widest mb-3 text-center">Valor da Aposta</label>
                                <div className="flex items-center justify-center gap-4">
                                  <button onClick={() => setBetAmount(prev => (Math.max(0, parseFloat(prev || '0') - 10)).toString())} className="w-12 h-12 bg-white/5 rounded-xl border border-white/10 text-white font-black hover:bg-orange-600 transition-colors">-</button>
                                  <input 
                                    type="number"
                                    value={betAmount}
                                    onChange={(e) => setBetAmount(e.target.value)}
                                    placeholder="0,00"
                                    className="bg-transparent text-center text-4xl font-black text-white w-32 outline-none"
                                  />
                                  <button onClick={() => setBetAmount(prev => (parseFloat(prev || '0') + 10).toString())} className="w-12 h-12 bg-white/5 rounded-xl border border-white/10 text-white font-black hover:bg-orange-600 transition-colors">+</button>
                                </div>
                              </div>

                              <button 
                                onClick={handleLionLuck}
                                disabled={isSpinning}
                                className={`w-full py-6 rounded-[32px] font-black text-2xl uppercase italic tracking-tighter transition-all transform active:scale-95 shadow-[0_20px_50px_rgba(234,88,12,0.3)] ${isSpinning ? 'bg-orange-900/50 text-white/20' : 'bg-gradient-to-r from-orange-600 to-red-600 text-white hover:shadow-orange-600/50'}`}
                              >
                                {isSpinning ? 'SORTEANDO...' : 'JOGAR AGORA'}
                              </button>
                              
                              <p className="text-[10px] text-center text-white/20 font-bold uppercase tracking-widest">Saldo Disponível: R$ {userData?.saldo.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
                            </div>
                          </div>
                        </div>
                      )}

                      <div className="bg-black/60 backdrop-blur-xl p-8 rounded-[32px] border border-white/5 shadow-2xl text-center">
                        <p className="text-[10px] text-white/30 uppercase tracking-[0.3em] font-black leading-relaxed">
                          ⚠️ Jogo responsável: Este é um sistema simulado. <br/>
                          Apostas envolvem riscos. Não use dinheiro essencial.
                        </p>
                      </div>
                    </motion.div>
                  )}

                  {/* Bitcoin and Investments Section removed as it's merged into Casino */}
                  
                  {/* SECURITY SECTION */}

                  {/* SECURITY SECTION */}
                  {dashboardSection === 'security' && (
                    <motion.div
                      key="section-security"
                      initial={{ opacity: 0, x: 20 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -20 }}
                      className="space-y-6"
                    >
                      <div className="bg-white/10 backdrop-blur-2xl p-8 rounded-[24px] border border-white/20 shadow-xl">
                        <div className="flex items-center gap-3 mb-8">
                          <div className="p-2 bg-white text-[#764ba2] rounded-lg">
                            <Shield size={20} />
                          </div>
                          <h3 className="text-xl font-bold">Segurança da Conta</h3>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
                          <div className="space-y-6">
                            <div>
                              <h4 className="font-bold mb-2 flex items-center gap-2">
                                <CheckCircle2 size={16} className="text-green-400" />
                                Proteção de Acesso
                              </h4>
                              <p className="text-sm text-white/60">Sua conta está protegida por criptografia de ponta a ponta e autenticação segura do Google Firebase.</p>
                            </div>
                            <div className="p-4 bg-white/5 rounded-xl border border-white/10 space-y-3">
                              <p className="text-xs font-bold uppercase tracking-widest text-white/60">Dados de Acesso</p>
                              <div className="flex justify-between items-center text-sm">
                                <span className="text-white/40">Email:</span>
                                <span className="font-mono">{userData.email}</span>
                              </div>
                              <div className="flex justify-between items-center text-sm">
                                <span className="text-white/40">ID do Cliente:</span>
                                <span className="font-mono text-[10px] opacity-60">#{userData.uid.slice(0, 10)}...</span>
                              </div>
                            </div>
                          </div>

                          <div className="bg-white/5 p-6 rounded-2xl border border-white/10">
                            <h4 className="font-bold mb-4">Alterar Senha</h4>
                            <form onSubmit={handleUpdatePassword} className="space-y-4">
                              <div>
                                <label className="block text-[10px] font-black uppercase tracking-widest text-white/40 mb-1">Nova Senha</label>
                                <input 
                                  name="novaSenha" 
                                  type="password" 
                                  required 
                                  className="w-full px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-white outline-none focus:ring-2 focus:ring-white/30 text-sm"
                                  placeholder="••••••••"
                                />
                              </div>
                              <div>
                                <label className="block text-[10px] font-black uppercase tracking-widest text-white/40 mb-1">Confirmar Nova Senha</label>
                                <input 
                                  name="confirmarNovaSenha" 
                                  type="password" 
                                  required 
                                  className="w-full px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-white outline-none focus:ring-2 focus:ring-white/30 text-sm"
                                  placeholder="••••••••"
                                />
                              </div>
                              <button 
                                type="submit"
                                className="w-full bg-white/10 hover:bg-white/20 border border-white/20 text-white font-bold py-2 rounded-xl transition-all shadow-xl active:scale-95 text-sm"
                              >
                                Atualizar Senha
                              </button>
                            </form>
                          </div>
                        </div>
                      </div>

                      <div className="bg-red-500/10 backdrop-blur-xl p-8 rounded-[24px] border border-red-500/20 shadow-xl flex flex-col md:flex-row items-center justify-between gap-6">
                        <div className="flex items-center gap-4">
                          <div className="p-3 bg-red-500/20 rounded-xl text-red-300"><AlertCircle size={32} /></div>
                          <div>
                            <h4 className="font-bold text-lg text-red-200">Área Crítica</h4>
                            <p className="text-sm text-red-200/60">Ao encerrar sua sessão ou trocar de senha, certifique-se de ter seus acessos salvos.</p>
                          </div>
                        </div>
                        <button 
                          onClick={handleLogout}
                          className="bg-red-500/20 hover:bg-red-500/40 border border-red-500/40 text-red-200 px-6 py-3 rounded-xl font-bold transition-all whitespace-nowrap"
                        >
                          Sair da Conta
                        </button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            ) : (
              <div className="flex flex-col items-center justify-center py-20 bg-white/10 backdrop-blur-md rounded-3xl border border-white/20">
                <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-white mb-4"></div>
                <p className="text-white/60">Carregando seu perfil...</p>
              </div>
            )
          )}

          {/* Admin Login View */}
          {view === 'admin' && !isAdminLoggedIn && (
            <motion.div
              key="admin-login"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="max-w-md mx-auto"
            >
              <div className="bg-white/10 backdrop-blur-2xl p-8 rounded-[24px] shadow-2xl border border-white/20 text-white">
                <div className="flex justify-center mb-6">
                  <div className="p-4 bg-white text-[#764ba2] rounded-full">
                    <Shield size={40} />
                  </div>
                </div>
                <h2 className="text-2xl font-bold mb-6 text-center">Painel Administrativo</h2>
                <form onSubmit={handleAdminLogin} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-white/70 mb-1">Usuário Admin</label>
                    <input 
                      name="adminUser" 
                      type="text" 
                      required 
                      className="w-full px-4 py-3 rounded-xl bg-white/10 border border-white/20 text-white focus:ring-2 focus:ring-white/30 outline-none transition-all"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-white/70 mb-1">Senha Admin</label>
                    <input 
                      name="adminPass" 
                      type="password" 
                      required 
                      className="w-full px-4 py-3 rounded-xl bg-white/10 border border-white/20 text-white focus:ring-2 focus:ring-white/30 outline-none transition-all"
                    />
                  </div>
                  <button 
                    type="submit"
                    className="w-full bg-white text-[#764ba2] font-bold py-3 rounded-xl transition-all hover:bg-white/90"
                  >
                    Acessar Painel
                  </button>
                  <button 
                    type="button"
                    onClick={() => setView('login')}
                    className="w-full text-sm text-white/40 hover:text-white/60 transition-colors mt-2"
                  >
                    Voltar ao Login
                  </button>
                </form>
              </div>
            </motion.div>
          )}

          {/* Admin Dashboard View */}
          {view === 'admin' && isAdminLoggedIn && (
            <motion.div
              key="admin-dashboard"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="space-y-8"
            >
              <div className="flex items-center justify-between">
                <h2 className="text-2xl font-bold flex items-center gap-2">
                  <Users className="text-white/80" />
                  Gerenciamento de Usuários
                </h2>
                <div className="text-sm bg-white/10 text-white px-3 py-1 rounded-full font-bold border border-white/20">
                  {allUsers.length} Usuários
                </div>
              </div>

              {/* Create User Form */}
              <div className="bg-white/10 backdrop-blur-xl p-6 rounded-[24px] border border-white/20 shadow-xl">
                <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
                  <Plus size={20} className="text-white" />
                  Novo Usuário
                </h3>
                <form onSubmit={createNewUserAdmin} className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <input name="nome" placeholder="Nome" required className="px-3 py-2 rounded-lg bg-white/10 border border-white/20 text-white placeholder:text-white/40 outline-none focus:ring-2 focus:ring-white/30" />
                  <input name="email" type="email" placeholder="Email" required className="px-3 py-2 rounded-lg bg-white/10 border border-white/20 text-white placeholder:text-white/40 outline-none focus:ring-2 focus:ring-white/30" />
                  <input name="senha" type="password" placeholder="Senha" required className="px-3 py-2 rounded-lg bg-white/10 border border-white/20 text-white placeholder:text-white/40 outline-none focus:ring-2 focus:ring-white/30" />
                  <input name="saldo" type="number" placeholder="Saldo Inicial" className="px-3 py-2 rounded-lg bg-white/10 border border-white/20 text-white placeholder:text-white/40 outline-none focus:ring-2 focus:ring-white/30" />
                  <button type="submit" className="md:col-span-4 bg-white text-[#764ba2] font-bold py-2 rounded-lg transition-colors hover:bg-white/90">
                    Criar Usuário
                  </button>
                </form>
                <p className="mt-2 text-xs text-white/40 italic">Nota: Criar usuário como admin fará o logout da sessão atual.</p>
              </div>

              {/* Users List */}
              <div className="bg-white/10 backdrop-blur-xl rounded-[24px] border border-white/20 shadow-xl overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <thead className="bg-white/5 border-b border-white/10">
                      <tr>
                        <th className="px-6 py-4 text-sm font-bold text-white/60">Nome / Email</th>
                        <th className="px-6 py-4 text-sm font-bold text-white/60">Saldo Atual</th>
                        <th className="px-6 py-4 text-sm font-bold text-white/60">Ações</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {allUsers.map((u) => (
                        <tr key={u.uid} className="hover:bg-white/5 transition-colors">
                          <td className="px-6 py-4">
                            <div className="font-bold text-white">{u.nome}</div>
                            <div className="text-xs text-white/50">{u.email}</div>
                          </td>
                          <td className="px-6 py-4 font-mono font-bold text-white">
                            R$ {u.saldo.toFixed(2)}
                          </td>
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-2">
                              <input 
                                type="number" 
                                id={`balance-${u.uid}`}
                                placeholder="Saldo"
                                className="w-24 px-2 py-1 text-sm rounded bg-white/10 border border-white/20 text-white outline-none focus:ring-1 focus:ring-white/30"
                              />
                              <button 
                                onClick={() => {
                                  const input = document.getElementById(`balance-${u.uid}`) as HTMLInputElement;
                                  const val = parseFloat(input.value);
                                  if (!isNaN(val)) updateBalanceAdmin(u.uid, val);
                                }}
                                className="bg-white text-[#764ba2] text-xs font-bold px-3 py-1.5 rounded transition-colors hover:bg-white/90"
                              >
                                Alterar
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Footer */}
      <footer className="mt-auto py-8 text-center text-white/40 text-xs">
        <p>© 2026 FrontBank08 - Sistema Bancário Fictício</p>
        <p className="mt-1">Desenvolvido com design Frosted Glass</p>
      </footer>
        {/* QR Code Modal */}
        <AnimatePresence>
          {isQrModalOpen && userData && (
            <motion.div 
              key="pix-qr-modal"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
            >
              <motion.div 
                initial={{ scale: 0.9, y: 20 }}
                animate={{ scale: 1, y: 0 }}
                exit={{ scale: 0.9, y: 20 }}
                className="bg-[#1a1a2e] w-full max-w-sm rounded-[32px] p-8 border border-white/10 shadow-2xl relative"
              >
                <button 
                  onClick={() => setIsQrModalOpen(false)}
                  className="absolute top-6 right-6 text-white/40 hover:text-white transition-colors"
                >
                  <X size={24} />
                </button>

                <div className="text-center mb-8">
                  <div className="w-16 h-16 bg-white/10 rounded-2xl flex items-center justify-center mx-auto mb-4 text-white">
                    <QrCode size={32} />
                  </div>
                  <h3 className="text-2xl font-bold text-white mb-2">Receber PIX</h3>
                  <p className="text-sm text-white/40">Gere um QR Code para cobrar alguém</p>
                </div>

                <div className="mb-6 space-y-4">
                  <div className="bg-white/5 p-4 rounded-2xl border border-white/10">
                    <label className="block text-[10px] font-black tracking-widest uppercase text-white/40 mb-2 text-center">Valor (Opcional)</label>
                    <input 
                      type="number"
                      value={qrAmount}
                      onChange={(e) => setQrAmount(e.target.value)}
                      placeholder="0,00"
                      className="w-full bg-transparent text-center text-3xl font-black text-white focus:outline-none placeholder:opacity-20"
                    />
                  </div>
                </div>

                <div className="bg-white p-6 rounded-3xl flex items-center justify-center mb-8 shadow-[0_0_40px_rgba(255,255,255,0.1)] relative min-h-[200px]">
                  {userData.pixKey && userData.nome ? (
                    <QRCodeSVG 
                      value={getPixPayload(userData.pixKey, userData.nome, qrAmount ? parseFloat(qrAmount) : undefined)} 
                      size={200}
                      level="H"
                      includeMargin={true}
                    />
                  ) : (
                    <div className="text-[#1a1a2e] text-center p-4">
                      <p className="font-bold text-sm">Chave PIX não encontrada</p>
                      <p className="text-[10px] opacity-60">Complete seu perfil para receber PIX</p>
                    </div>
                  )}
                </div>

                <div className="space-y-4">
                  <button 
                    onClick={() => {
                      const payload = getPixPayload(userData.pixKey, userData.nome, qrAmount ? parseFloat(qrAmount) : undefined);
                      navigator.clipboard.writeText(payload);
                      showToast('PIX Copia e Cola copiado!');
                    }}
                    className="w-full bg-white text-[#1a1a2e] font-black py-4 rounded-2xl flex items-center justify-center gap-3 active:scale-95 transition-all shadow-xl"
                  >
                    <Copy size={20} />
                    Copiar Código
                  </button>
                  <p className="text-[10px] text-center text-white/20 uppercase tracking-[0.2em] font-bold">Chave: {userData.pixKey}</p>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
        
        {/* NFC Simulation Modal */}
        <AnimatePresence>
          {isNfcModalOpen && userData && (
            <motion.div 
              key="nfc-payment-modal"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/90 backdrop-blur-md"
            >
              <motion.div 
                initial={{ scale: 0.9, y: 20 }}
                animate={{ scale: 1, y: 0 }}
                exit={{ scale: 0.9, y: 20 }}
                className="bg-[#0f0f1a] w-full max-w-sm rounded-[40px] p-10 border border-white/10 shadow-[0_0_100px_rgba(255,255,255,0.05)] relative overflow-hidden"
              >
                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-white/20 to-transparent"></div>
                
                <button 
                  onClick={() => setIsNfcModalOpen(false)}
                  className="absolute top-8 right-8 text-white/40 hover:text-white transition-colors"
                >
                  <X size={24} />
                </button>

                <div className="text-center mb-10">
                  <motion.div 
                    animate={nfcStep === 'scanning' ? { scale: [1, 1.1, 1], opacity: [1, 0.5, 1] } : {}}
                    transition={{ repeat: Infinity, duration: 1.5 }}
                    className={`w-24 h-24 rounded-3xl flex items-center justify-center mx-auto mb-6 text-white shadow-2xl ${nfcStep === 'success' ? 'bg-green-500 shadow-green-500/20' : nfcStep === 'error' ? 'bg-red-500 shadow-red-500/20' : 'bg-white/10 border border-white/20'}`}
                  >
                    {nfcStep === 'success' ? <CheckCircle2 size={48} /> : nfcStep === 'error' ? <AlertCircle size={48} /> : <Zap size={48} />}
                  </motion.div>
                  <h3 className="text-3xl font-black text-white italic uppercase tracking-tighter">
                    {nfcStep === 'start' ? 'Pagamento NFC' : nfcStep === 'scanning' ? 'Aproximando...' : nfcStep === 'success' ? 'Sucesso!' : 'Falha!'}
                  </h3>
                  <p className="text-sm text-white/40 mt-2">
                    {nfcStep === 'start' ? 'Aproxime seu dispositivo da maquininha' : nfcStep === 'scanning' ? 'Mantenha o dispositivo próximo' : nfcStep === 'success' ? 'Transação confirmada' : 'Tente novamente'}
                  </p>
                </div>

                {nfcStep === 'start' && (
                  <div className="space-y-6">
                    <div className="space-y-4">
                      <div className="bg-white/5 p-6 rounded-3xl border border-white/10">
                        <label className="block text-[10px] font-black tracking-[0.3em] uppercase text-white/40 mb-4 text-center">Valor do Pagamento</label>
                        <input 
                          type="number"
                          value={nfcAmount}
                          onChange={(e) => setNfcAmount(e.target.value)}
                          placeholder="0,00"
                          className="w-full bg-transparent text-center text-4xl font-black text-white focus:outline-none placeholder:opacity-20"
                        />
                      </div>
                      <div className="bg-white/5 p-4 rounded-2xl border border-white/10">
                        <label className="block text-[10px] font-black tracking-[0.3em] uppercase text-white/40 mb-2 text-center">Chave PIX Destino</label>
                        <input 
                          type="text"
                          value={nfcRecipient}
                          onChange={(e) => setNfcRecipient(e.target.value)}
                          placeholder="Email ou Chave"
                          className="w-full bg-transparent text-center text-sm font-bold text-white focus:outline-none placeholder:opacity-20 uppercase tracking-widest"
                        />
                      </div>
                      
                      <div className="bg-white/5 p-4 rounded-2xl border border-white/10">
                        <label className="block text-[10px] font-black tracking-[0.3em] uppercase text-white/40 mb-3 text-center">Fonte de Pagamento</label>
                        <select 
                          value={selectedNfcCard}
                          onChange={(e) => setSelectedNfcCard(e.target.value)}
                          className="w-full bg-transparent text-center text-xs font-black text-white focus:outline-none uppercase tracking-widest cursor-pointer"
                        >
                          <option value="balance" className="bg-[#1a1a2e]">Saldo da Conta</option>
                          {cards.filter(c => c.status === 'active').map(card => (
                            <option key={card.id} value={card.id} className="bg-[#1a1a2e]">
                              Cartão Virtual {card.cardNumber.slice(-4)}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                    
                    <button 
                      onClick={handleNfcPayment}
                      className="w-full bg-white text-black font-black py-6 rounded-3xl text-xl uppercase italic tracking-tighter shadow-2xl active:scale-95 transition-all flex items-center justify-center gap-3"
                    >
                      <Plus size={24} />
                      Simular Aproximação
                    </button>
                    
                    <p className="text-[10px] text-center text-white/20 uppercase tracking-[0.2em] font-bold">Saldo: R$ {userData.saldo.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
                  </div>
                )}

                {(nfcStep === 'success' || nfcStep === 'error') && (
                  <button 
                    onClick={() => setIsNfcModalOpen(false)}
                    className="w-full bg-white/10 hover:bg-white/20 text-white font-black py-5 rounded-3xl text-lg uppercase tracking-widest transition-all"
                  >
                    Fechar
                  </button>
                )}
                
                {nfcStep === 'scanning' && (
                  <div className="py-10 flex flex-col items-center">
                    <div className="w-full h-1 bg-white/5 rounded-full overflow-hidden">
                      <motion.div 
                        initial={{ x: '-100%' }}
                        animate={{ x: '100%' }}
                        transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
                        className="w-1/2 h-full bg-white opacity-40 shadow-[0_0_20px_white]"
                      />
                    </div>
                  </div>
                )}
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </ErrorBoundary>
  );
}
