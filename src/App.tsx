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
  Download
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
  const [dashboardSection, setDashboardSection] = useState<'main' | 'cards' | 'history' | 'security'>('main');
  const [isQrModalOpen, setIsQrModalOpen] = useState(false);
  const [qrAmount, setQrAmount] = useState<string>('');
  const [toasts, setToasts] = useState<Toast[]>([]);
  
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

                    <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
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
