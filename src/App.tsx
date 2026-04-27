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
  Zap
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
  const [qrAmount, setQrAmount] = useState<string>('');
  const [toasts, setToasts] = useState<Toast[]>([]);
  
  // Bitcoin State
  const [btcPrice, setBtcPrice] = useState<number | null>(null);
  const [btcHistory, setBtcHistory] = useState<number[]>([]);
  const [btcChange, setBtcChange] = useState<number>(0);
  const [isInvesting, setIsInvesting] = useState(false);
  const [investAction, setInvestAction] = useState<'buy' | 'sell'>('buy');
  const [investAmount, setInvestAmount] = useState<string>('');
  const [casinoSubTab, setCasinoSubTab] = useState<'bitcoin' | 'lion'>('lion');

  // Lion Game State
  const [betAmount, setBetAmount] = useState<string>('');
  const [isSpinning, setIsSpinning] = useState(false);
  const [slotResult, setSlotResult] = useState<string[]>(['LION', 'LION', 'LION']);
  const [gameMessage, setGameMessage] = useState('FAÇA SUA APOSTA');

  const renderSlotSymbol = (symbol: string) => {
    switch (symbol) {
      case 'LION':
        return (
          <svg viewBox="0 0 24 24" className="w-16 h-16 text-orange-500 fill-none stroke-current stroke-[1.5]">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z" />
            <path d="M12 7c-2.76 0-5 2.24-5 5s2.24 5 5 5 5-2.24 5-5-2.24-5-5-5zm0 8c-1.65 0-3-1.35-3-3s1.35-3 3-3 3 1.35 3 3-1.35 3-3 3z" />
            <path d="M12 10v4M10 12h4M12 12l2 2M12 12l-2-2M12 12l2-2M12 12l-2 2" />
            <path d="M7 7l1.5 1.5M17 7l-1.5 1.5M7 17l1.5-1.5M17 17l-1.5-1.5" />
          </svg>
        );
      case 'FIRE':
        return <Zap size={48} className="text-red-500" />;
      case 'DIAMOND':
        return <Trophy size={48} className="text-blue-400" />;
      case 'ORANGE':
        return <Dices size={48} className="text-orange-400" />;
      case 'SEVEN':
        return <span className="text-6xl font-black text-white italic">7</span>;
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

  // Fetch Bitcoin Price
  useEffect(() => {
    const fetchBtcPrice = async () => {
      try {
        const response = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=brl&include_24hr_change=true');
        const data = await response.json();
        const price = data.bitcoin.brl;
        const change = data.bitcoin.brl_24h_change;
        
        setBtcPrice(price);
        setBtcChange(change);
        setBtcHistory(prev => {
          const newHistory = [...prev, price].slice(-20);
          return newHistory;
        });
      } catch (error) {
        console.error('Error fetching BTC price:', error);
      }
    };

    if (dashboardSection === 'investments') {
      fetchBtcPrice();
      const interval = setInterval(fetchBtcPrice, 30000); // 30 seconds
      return () => clearInterval(interval);
    }
  }, [dashboardSection]);

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
      showToast(error.message, 'error');
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
    if (!userData || !btcPrice) return;

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
        const currentBtcBalance = currentData.btcBalance || 0;

        if (investAction === 'buy') {
          if (currentBalance < amount) throw new Error('Saldo insuficiente');
          
          const btcToReceive = amount / btcPrice;
          transaction.update(userRef, {
            saldo: currentBalance - amount,
            btcBalance: currentBtcBalance + btcToReceive
          });

          // Transaction log
          const transRef = doc(collection(db, 'transactions'));
          transaction.set(transRef, {
            from: userData.uid,
            to: 'BITCOIN_EXCHANGE',
            senderUid: userData.uid,
            senderName: userData.nome,
            recipientUid: 'BITCOIN_EXCHANGE',
            recipientName: 'Mercado Bitcoin',
            tipo: 'INVESTMENT',
            amount: amount,
            btcAmount: btcToReceive,
            action: 'BUY',
            timestamp: serverTimestamp()
          });
        } else {
          // Sell
          const btcToSell = amount / btcPrice;
          if (currentBtcBalance < btcToSell) throw new Error('BTC insuficiente');

          transaction.update(userRef, {
            saldo: currentBalance + amount,
            btcBalance: currentBtcBalance - btcToSell
          });

          // Transaction log
          const transRef = doc(collection(db, 'transactions'));
          transaction.set(transRef, {
            from: 'BITCOIN_EXCHANGE',
            to: userData.uid,
            senderUid: 'BITCOIN_EXCHANGE',
            senderName: 'Mercado Bitcoin',
            recipientUid: userData.uid,
            recipientName: userData.nome,
            tipo: 'INVESTMENT',
            amount: amount,
            btcAmount: btcToSell,
            action: 'SELL',
            timestamp: serverTimestamp()
          });
        }
      });

      showToast(`${investAction === 'buy' ? 'Compra' : 'Venda'} realizada com sucesso!`);
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

  const getPixPayload = (key: string, name: string, amount?: number) => {
    const cleanName = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").slice(0, 25);
    const accountInfo = `0014br.gov.bcb.pix01${key.length.toString().padStart(2, '0')}${key}`;
    const payload = [
      '000201',
      `26${accountInfo.length.toString().padStart(2, '0')}${accountInfo}`,
      '52040000',
      '5303986',
      amount ? `54${amount.toFixed(2).length.toString().padStart(2, '0')}${amount.toFixed(2)}` : '',
      '5802BR',
      `59${cleanName.length.toString().padStart(2, '0')}${cleanName.toUpperCase()}`,
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
                        className={`p-4 rounded-2xl border transition-all flex flex-col items-center gap-2 ${dashboardSection === 'casino' || dashboardSection === 'investments' ? 'bg-orange-600 text-white border-orange-400 shadow-[0_0_15px_rgba(234,88,12,0.4)]' : 'bg-white/5 text-white border-white/10 hover:bg-white/10'}`}
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
                          <div className="md:col-span-2">
                            <button 
                              type="submit"
                              className="w-full bg-white text-[#764ba2] font-bold py-4 rounded-xl shadow-xl transition-all transform active:scale-95 flex items-center justify-center gap-2 hover:bg-white/90"
                            >
                              <ArrowRightLeft size={20} />
                              Confirmar Transferência
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
                      <div className="flex bg-black/40 p-2 rounded-2xl border border-white/5 gap-2">
                        <button 
                          onClick={() => setCasinoSubTab('lion')}
                          className={`flex-1 py-3 rounded-xl font-black text-xs uppercase tracking-[0.2em] transition-all flex items-center justify-center gap-2 ${casinoSubTab === 'lion' ? 'bg-orange-600 text-white shadow-lg' : 'text-white/40 hover:bg-white/5'}`}
                        >
                          <Zap size={14} /> Lion Luck
                        </button>
                        <button 
                          onClick={() => setCasinoSubTab('bitcoin')}
                          className={`flex-1 py-3 rounded-xl font-black text-xs uppercase tracking-[0.2em] transition-all flex items-center justify-center gap-2 ${casinoSubTab === 'bitcoin' ? 'bg-orange-600 text-white shadow-lg' : 'text-white/40 hover:bg-white/5'}`}
                        >
                          <Bitcoin size={14} /> Bitcoin
                        </button>
                      </div>

                      {casinoSubTab === 'bitcoin' ? (
                        /* BITCOIN UI (Already defined, reused here) */
                        <div className="bg-[#0a0a0a] backdrop-blur-2xl p-8 rounded-[32px] border border-orange-500/30 shadow-[0_0_50px_rgba(249,115,22,0.15)] overflow-hidden relative">
                           {/* ... Content of Bitcoin section inherited from before ... */}
                           <div className="absolute -top-24 -right-24 w-64 h-64 bg-orange-500/10 rounded-full blur-[80px]"></div>
                           <div className="relative z-10">
                            <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-12">
                              <div className="flex items-center gap-4">
                                <div className="w-16 h-16 bg-orange-500 flex items-center justify-center rounded-2xl shadow-[0_0_20px_rgba(249,115,22,0.5)] transform -rotate-3">
                                  <Bitcoin size={32} className="text-black" />
                                </div>
                                <div>
                                  <h3 className="text-2xl font-black text-white italic uppercase tracking-tighter">Market Bitcoin</h3>
                                  <p className="text-orange-500/60 text-xs font-bold tracking-widest uppercase">Operação em Tempo Real</p>
                                </div>
                              </div>
                              <div className="text-right">
                                <p className="text-[10px] font-black text-white/40 uppercase tracking-[0.2em] mb-1">Preço Atual (BRL)</p>
                                <div className="flex items-center justify-end gap-3">
                                  <h4 className="text-4xl font-black text-white tracking-tighter">
                                    {btcPrice ? `R$ ${btcPrice.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : '---'}
                                  </h4>
                                  <div className={`px-2 py-1 rounded-md text-[10px] font-black flex items-center gap-1 ${btcChange >= 0 ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-500'}`}>
                                    {btcChange >= 0 ? <ArrowUpRight size={10} /> : <ArrowDownRight size={10} />}
                                    {Math.abs(btcChange).toFixed(2)}%
                                  </div>
                                </div>
                              </div>
                            </div>

                            <div className="bg-black/40 h-48 rounded-3xl mb-12 border border-white/5 relative flex items-end p-4 overflow-hidden">
                              <svg className="w-full h-full opacity-60" viewBox="0 0 100 100" preserveAspectRatio="none">
                                <path 
                                  d={`M 0 100 ${btcHistory.map((p, i) => `L ${(i / (btcHistory.length - 1)) * 100} ${100 - ((p - Math.min(...btcHistory)) / (Math.max(...btcHistory) - Math.min(...btcHistory) || 1)) * 80}`).join(' ')} L 100 100 Z`}
                                  fill="url(#gradient-btc)"
                                />
                                <path 
                                  d={`M 0 ${100 - ((btcHistory[0] - Math.min(...btcHistory)) / (Math.max(...btcHistory) - Math.min(...btcHistory) || 1)) * 80} ${btcHistory.map((p, i) => `L ${(i / (btcHistory.length - 1)) * 100} ${100 - ((p - Math.min(...btcHistory)) / (Math.max(...btcHistory) - Math.min(...btcHistory) || 1)) * 80}`).join(' ')}`}
                                  fill="none"
                                  stroke="#f39c12"
                                  strokeWidth="2"
                                />
                                <defs>
                                  <linearGradient id="gradient-btc" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="0%" stopColor="#f39c12" stopOpacity="0.4" />
                                    <stop offset="100%" stopColor="#f39c12" stopOpacity="0" />
                                  </linearGradient>
                                </defs>
                              </svg>
                            </div>

                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                                <div className="space-y-6">
                                  <div className="bg-white/5 p-6 rounded-2xl border border-white/10">
                                    <p className="text-[10px] font-black uppercase tracking-widest text-white/40 mb-3">Sua Carteira Bitcoin</p>
                                    <div className="flex items-center justify-between">
                                      <div className="flex items-center gap-3">
                                        <div className="w-10 h-10 bg-orange-500/20 text-orange-500 rounded-xl flex items-center justify-center">
                                          <Bitcoin size={20} />
                                        </div>
                                        <div>
                                          <p className="text-xl font-black text-white">{(userData?.btcBalance || 0).toFixed(8)} BTC</p>
                                          <p className="text-[10px] text-white/40 font-bold">~ R$ {((userData?.btcBalance || 0) * (btcPrice || 0)).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
                                        </div>
                                      </div>
                                    </div>
                                  </div>
                                  <div className="flex gap-2">
                                    <button onClick={() => setInvestAction('buy')} className={`flex-1 py-4 rounded-xl font-black text-sm uppercase tracking-widest transition-all ${investAction === 'buy' ? 'bg-orange-500 text-black' : 'bg-white/5 text-white'}`}>Comprar</button>
                                    <button onClick={() => setInvestAction('sell')} className={`flex-1 py-4 rounded-xl font-black text-sm uppercase tracking-widest transition-all ${investAction === 'sell' ? 'bg-red-600 text-white' : 'bg-white/5 text-white'}`}>Vender</button>
                                  </div>
                                </div>
                                <form onSubmit={handleBitcoinTrade} className="bg-white/5 p-8 rounded-3xl border border-white/10 space-y-6">
                                  <input type="number" value={investAmount} onChange={(e) => setInvestAmount(e.target.value)} placeholder="Valor BRL" className="w-full bg-black/40 border-2 border-white/10 rounded-2xl py-4 px-6 text-xl font-black text-white outline-none focus:border-orange-500" />
                                  <button type="submit" className={`w-full py-5 rounded-2xl font-black text-lg uppercase tracking-widest transition-all ${investAction === 'buy' ? 'bg-orange-500 text-black' : 'bg-red-600 text-white'}`}>
                                    {isInvesting ? 'Processando...' : 'Confirmar'}
                                  </button>
                                </form>
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
                                    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z" />
                                    <path d="M12 7c-2.76 0-5 2.24-5 5s2.24 5 5 5 5-2.24 5-5-2.24-5-5-5z" />
                                    <path d="M12 10l-2 5h4l-2-5z" />
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

                <div className="bg-white p-6 rounded-3xl flex items-center justify-center mb-8 shadow-[0_0_40px_rgba(255,255,255,0.1)]">
                  <QRCodeSVG 
                    value={getPixPayload(userData.pixKey, userData.nome, qrAmount ? parseFloat(qrAmount) : undefined)} 
                    size={200}
                    level="H"
                  />
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
      </div>
    </ErrorBoundary>
  );
}
