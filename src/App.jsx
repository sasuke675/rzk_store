import React, { useState, useEffect } from 'react';
import { supabase } from './supabaseClient';
import { generateDynamicQRIS } from './utils/qris';
import QRCode from 'qrcode';
import { 
  ShoppingBag, 
  Settings, 
  Lock, 
  X, 
  Copy, 
  CheckCircle, 
  AlertCircle, 
  Plus, 
  Trash, 
  RefreshCw, 
  ExternalLink,
  Eye,
  Key,
  ShoppingCart,
  Clock,
  Wallet,
  Menu,
  ChevronRight,
  HelpCircle,
  User,
  History,
  Info
} from 'lucide-react';
import './App.css';

// QRIS Statis Merchant Default (DANA Bisnis RZK Store milik Anda)
const DEFAULT_STATIC_QRIS = '00020101021126570011ID.DANA.WWW011893600915302634402802090263440280303UMI51440014ID.CO.QRIS.WWW0215ID10265391682640303UMI5204481453033605802ID5908rz store6015Kab. Ogan Komer610532159630485BE';

function App() {
  const [products, setProducts] = useState([]);
  
  // Navigation Tabs: 'catalog' | 'my-orders' | 'admin-dashboard' | 'admin-products' | 'admin-transactions'
  const [currentTab, setCurrentTab] = useState('catalog'); 
  
  const [adminAuthenticated, setAdminAuthenticated] = useState(false);
  const [isAdminMode, setIsAdminMode] = useState(false);
  const [adminEmailInput, setAdminEmailInput] = useState('');
  const [adminPasswordInput, setAdminPasswordInput] = useState('');
  const [staticQris, setStaticQris] = useState(() => {
    return localStorage.getItem('rzk_static_qris') || DEFAULT_STATIC_QRIS;
  });

  // Buyer Info & Purchased Transactions (Stored in LocalStorage)
  const [buyerName, setBuyerName] = useState(() => localStorage.getItem('rzk_buyer_name') || '');
  const [buyerEmail, setBuyerEmail] = useState(() => localStorage.getItem('rzk_buyer_email') || '');
  const [buyerPhone, setBuyerPhone] = useState(() => localStorage.getItem('rzk_buyer_phone') || '');
  const [myTransactions, setMyTransactions] = useState([]);
  
  // Stats (calculated from myTransactions or adminTransactions)
  const [stats, setStats] = useState({
    totalCount: 0,
    successCount: 0,
    pendingCount: 0,
    totalSpent: 0
  });

  // Modal Checkout State
  const [checkoutProduct, setCheckoutProduct] = useState(null);
  const [loadingCheckout, setLoadingCheckout] = useState(false);

  const [activeTx, setActiveTx] = useState(null);
  const [txStatus, setTxStatus] = useState('pending'); // 'pending' | 'paid' | 'expired'
  const [timeLeft, setTimeLeft] = useState(null);
  const [dynamicQrisPayload, setDynamicQrisPayload] = useState('');
  const [qrisQrCodeUrl, setQrisQrCodeUrl] = useState('');
  const [vmessQrCodeUrl, setVmessQrCodeUrl] = useState('');
  const [copiedVmess, setCopiedVmess] = useState(false);

  // Admin Dashboard State
  const [adminProducts, setAdminProducts] = useState([]);
  const [adminTransactions, setAdminTransactions] = useState([]);
  const [newProductName, setNewProductName] = useState('');
  const [newProductPrice, setNewProductPrice] = useState('');
  const [newProductDesc, setNewProductDesc] = useState('');
  const [newProductVmess, setNewProductVmess] = useState('');
  const [loadingAdminAction, setLoadingAdminAction] = useState(false);

  // Cek path URL & inisialisasi session auth Supabase saat mount
  useEffect(() => {
    fetchProducts();
    loadMyOrders();

    // 1. Cek path URL pathname
    if (window.location.pathname === '/admin') {
      setIsAdminMode(true);
      setCurrentTab('admin-dashboard');
    } else {
      setIsAdminMode(false);
      setCurrentTab('catalog');
    }

    // 2. Cek session aktif Supabase
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session && session.user.email === 'ahmadrozikin731@gmail.com') {
        setAdminAuthenticated(true);
      } else {
        setAdminAuthenticated(false);
      }
    });

    // 3. Dengarkan perubahan status auth
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session && session.user.email === 'ahmadrozikin731@gmail.com') {
        setAdminAuthenticated(true);
      } else {
        setAdminAuthenticated(false);
      }
    });

    // 4. Popstate handler untuk Back/Forward browser
    const handlePopState = () => {
      if (window.location.pathname === '/admin') {
        setIsAdminMode(true);
        setCurrentTab('admin-dashboard');
      } else {
        setIsAdminMode(false);
        setCurrentTab('catalog');
      }
    };
    window.addEventListener('popstate', handlePopState);

    return () => {
      subscription.unsubscribe();
      window.removeEventListener('popstate', handlePopState);
    };
  }, []);

  // Sync / Hitung Stats Pembeli secara lokal
  useEffect(() => {
    if (myTransactions.length > 0) {
      const total = myTransactions.length;
      const success = myTransactions.filter(t => t.status === 'paid').length;
      const pending = myTransactions.filter(t => t.status === 'pending').length;
      const spent = myTransactions
        .filter(t => t.status === 'paid')
        .reduce((sum, t) => sum + Number(t.amount || 0), 0);

      setStats({
        totalCount: total,
        successCount: success,
        pendingCount: pending,
        totalSpent: spent
      });
    } else {
      setStats({ totalCount: 0, successCount: 0, pendingCount: 0, totalSpent: 0 });
    }
  }, [myTransactions]);

  // Fetch data admin jika tab diubah ke admin
  useEffect(() => {
    if (adminAuthenticated && currentTab.startsWith('admin')) {
      fetchAdminData();
    }
  }, [adminAuthenticated, currentTab]);

  // Sync stats Admin jika data admin ter-update
  useEffect(() => {
    if (currentTab.startsWith('admin') && adminTransactions.length > 0) {
      const total = adminTransactions.length;
      const success = adminTransactions.filter(t => t.status === 'paid').length;
      const pending = adminTransactions.filter(t => t.status === 'pending').length;
      const revenue = adminTransactions
        .filter(t => t.status === 'paid')
        .reduce((sum, t) => sum + Number(t.amount || 0), 0);

      setStats({
        totalCount: total,
        successCount: success,
        pendingCount: pending,
        totalSpent: revenue
      });
    }
  }, [adminTransactions, currentTab]);

  // Realtime Listener untuk transaksi aktif
  useEffect(() => {
    if (!activeTx || txStatus === 'paid' || txStatus === 'expired') return;

    const channel = supabase
      .channel(`active-tx-${activeTx.id}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'transactions',
          filter: `id=eq.${activeTx.id}`
        },
        (payload) => {
          console.log('Realtime update received:', payload);
          if (payload.new && payload.new.status === 'paid') {
            setTxStatus('paid');
            // Refresh riwayat pesanan lokal
            loadMyOrders();
            // Ambil detail produk yang sukses untuk menampilkan vmess
            fetchSuccessProductConfig(activeTx.product_id);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [activeTx, txStatus]);

  // Effect untuk countdown timer 20 menit (1200 detik)
  useEffect(() => {
    if (!activeTx || txStatus !== 'pending') {
      setTimeLeft(null);
      return;
    }

    const calculateTimeLeft = () => {
      const createdAt = new Date(activeTx.created_at).getTime();
      const now = new Date().getTime();
      const elapsed = Math.floor((now - createdAt) / 1000); // dalam detik
      const limit = 20 * 60; // 20 menit
      const remaining = limit - elapsed;

      if (remaining <= 0) {
        handleTransactionExpire();
        return 0;
      }
      return remaining;
    };

    // Hitung pertama kali
    setTimeLeft(calculateTimeLeft());

    const timer = setInterval(() => {
      setTimeLeft((prev) => {
        const nextVal = calculateTimeLeft();
        if (nextVal <= 0) {
          clearInterval(timer);
          return 0;
        }
        return nextVal;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [activeTx, txStatus]);

  const handleTransactionExpire = async () => {
    if (!activeTx) return;
    setTxStatus('expired');
    
    try {
      await supabase
        .from('transactions')
        .update({ 
          status: 'expired', 
          updated_at: new Date().toISOString() 
        })
        .eq('id', activeTx.id)
        .eq('status', 'pending');
      
      // Refresh riwayat pesanan lokal
      loadMyOrders();
    } catch (err) {
      console.error('Gagal memperbarui status transaksi kadaluarsa:', err.message);
    }
  };

  const formatTime = (seconds) => {
    if (seconds === null || seconds <= 0) return '00:00';
    const mins = Math.floor(seconds / 60).toString().padStart(2, '0');
    const secs = (seconds % 60).toString().padStart(2, '0');
    return `${mins}:${secs}`;
  };

  const isTxExpired = (tx) => {
    if (tx.status !== 'pending') return false;
    const createdAt = new Date(tx.created_at).getTime();
    const now = new Date().getTime();
    const elapsed = Math.floor((now - createdAt) / 1000);
    return elapsed > 20 * 60; // lebih dari 20 menit
  };

  const fetchProducts = async () => {
    try {
      const { data, error } = await supabase
        .from('products')
        .select('*')
        .order('price', { ascending: true });
      if (error) throw error;
      setProducts(data || []);
    } catch (err) {
      console.error('Error fetching products:', err.message);
    }
  };

  const loadMyOrders = async () => {
    const localTxIds = JSON.parse(localStorage.getItem('rzk_buyer_txs') || '[]');
    if (localTxIds.length === 0) return;

    try {
      const { data, error } = await supabase
        .from('transactions')
        .select('*, products(name)')
        .in('id', localTxIds)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setMyTransactions(data || []);
    } catch (err) {
      console.error('Error loading my orders:', err.message);
    }
  };

  const fetchAdminData = async () => {
    try {
      const { data: prodData, error: prodErr } = await supabase
        .from('products')
        .select('*')
        .order('created_at', { ascending: false });
      if (prodErr) throw prodErr;
      setAdminProducts(prodData || []);

      const { data: txData, error: txErr } = await supabase
        .from('transactions')
        .select('*, products(name)')
        .order('created_at', { ascending: false });
      if (txErr) throw txErr;
      setAdminTransactions(txData || []);
    } catch (err) {
      console.error('Error fetching admin data:', err.message);
    }
  };

  const fetchSuccessProductConfig = async (productId) => {
    try {
      const { data, error } = await supabase
        .from('products')
        .select('vpn_config')
        .eq('id', productId)
        .single();
      if (error) throw error;
      
      if (data && data.vpn_config) {
        const qrUrl = await QRCode.toDataURL(data.vpn_config, { width: 250, margin: 2 });
        setVmessQrCodeUrl(qrUrl);
        setActiveTx(prev => ({ ...prev, vpn_config: data.vpn_config }));
      }
    } catch (err) {
      console.error('Error fetching success vmess:', err.message);
    }
  };

  const handleCheckoutSubmit = async (e) => {
    e.preventDefault();
    if (!buyerName || !buyerEmail || !buyerPhone || !checkoutProduct) return;

    // Simpan info pembeli ke localStorage
    localStorage.setItem('rzk_buyer_name', buyerName);
    localStorage.setItem('rzk_buyer_email', buyerEmail);
    localStorage.setItem('rzk_buyer_phone', buyerPhone);

    setLoadingCheckout(true);
    try {
      let uniqueCode = 1;
      let isColliding = true;
      let finalAmount = '';
      let attempts = 0;
      const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();

      while (isColliding && attempts < 15) {
        uniqueCode = Math.floor(Math.random() * 99) + 1;
        finalAmount = (checkoutProduct.price + uniqueCode).toString();

        const { data, error } = await supabase
          .from('transactions')
          .select('id')
          .eq('status', 'pending')
          .eq('amount', finalAmount)
          .gte('created_at', thirtyMinutesAgo)
          .limit(1);

        if (error) throw error;

        if (!data || data.length === 0) {
          isColliding = false;
        }
        attempts++;
      }

      const { data: newTx, error: txErr } = await supabase
        .from('transactions')
        .insert({
          product_id: checkoutProduct.id,
          buyer_name: buyerName,
          buyer_email: buyerEmail,
          buyer_phone: buyerPhone,
          amount: finalAmount,
          unique_code: uniqueCode,
          status: 'pending'
        })
        .select()
        .single();

      if (txErr) throw txErr;

      // Kirim notifikasi Telegram secara asynchronous (non-blocking)
      fetch('/.netlify/functions/telegram-bot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'send_notification',
          transaction: newTx,
          product_name: checkoutProduct.name
        })
      }).catch(err => console.error('Gagal mengirim notifikasi Telegram:', err));

      // Simpan ID transaksi ini ke daftar pembelian lokal pembeli
      const localTxIds = JSON.parse(localStorage.getItem('rzk_buyer_txs') || '[]');
      localTxIds.push(newTx.id);
      localStorage.setItem('rzk_buyer_txs', JSON.stringify(localTxIds));

      const qrisPayload = generateDynamicQRIS(staticQris, finalAmount);
      setDynamicQrisPayload(qrisPayload);

      const qrUrl = await QRCode.toDataURL(qrisPayload, { width: 300, margin: 2 });
      setQrisQrCodeUrl(qrUrl);

      setActiveTx(newTx);
      setTxStatus('pending');
      setCheckoutProduct(null);
      loadMyOrders();
    } catch (err) {
      alert('Gagal memproses transaksi: ' + err.message);
    } finally {
      setLoadingCheckout(false);
    }
  };

  const handleAdminLogin = async (e) => {
    e.preventDefault();
    if (!adminEmailInput || !adminPasswordInput) return;

    setLoadingAdminAction(true);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: adminEmailInput,
        password: adminPasswordInput
      });

      if (error) throw error;

      // Pastikan email yang login adalah email admin khusus Anda
      if (data.user && data.user.email === 'ahmadrozikin731@gmail.com') {
        setAdminAuthenticated(true);
        setAdminEmailInput('');
        setAdminPasswordInput('');
        fetchAdminData();
      } else {
        await supabase.auth.signOut();
        alert('Akses Ditolak: Anda bukan Admin RZK Store!');
      }
    } catch (err) {
      alert('Login Gagal: ' + err.message);
    } finally {
      setLoadingAdminAction(false);
    }
  };

  const handleAdminLogout = async () => {
    try {
      await supabase.auth.signOut();
      setAdminAuthenticated(false);
      handleBackToStore();
    } catch (err) {
      console.error('Error logging out:', err.message);
    }
  };

  const handleBackToStore = () => {
    window.history.pushState({}, '', '/');
    setIsAdminMode(false);
    setCurrentTab('catalog');
  };

  const handleAddProduct = async (e) => {
    e.preventDefault();
    if (!newProductName || !newProductPrice || !newProductVmess) return;

    setLoadingAdminAction(true);
    try {
      const { error } = await supabase
        .from('products')
        .insert({
          name: newProductName,
          price: Number(newProductPrice),
          description: newProductDesc,
          vpn_config: newProductVmess
        });

      if (error) throw error;

      alert('Produk berhasil ditambahkan!');
      setNewProductName('');
      setNewProductPrice('');
      setNewProductDesc('');
      setNewProductVmess('');
      
      fetchAdminData();
      fetchProducts();
    } catch (err) {
      alert('Gagal menambah produk: ' + err.message);
    } finally {
      setLoadingAdminAction(false);
    }
  };

  const handleDeleteProduct = async (id) => {
    if (!confirm('Apakah Anda yakin ingin menghapus produk ini?')) return;

    setLoadingAdminAction(true);
    try {
      const { error } = await supabase
        .from('products')
        .delete()
        .eq('id', id);

      if (error) throw error;

      alert('Produk berhasil dihapus!');
      fetchAdminData();
      fetchProducts();
    } catch (err) {
      alert('Gagal menghapus produk: ' + err.message);
    } finally {
      setLoadingAdminAction(false);
    }
  };

  const handleSaveStaticQris = (e) => {
    e.preventDefault();
    localStorage.setItem('rzk_static_qris', staticQris);
    alert('QRIS Statis Merchant berhasil disimpan!');
  };

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
    setCopiedVmess(true);
    setTimeout(() => setCopiedVmess(false), 2000);
  };

  const handleSidebarClick = (tab) => {
    setCurrentTab(tab);
    if (!tab.startsWith('admin')) {
      loadMyOrders();
    }
  };

  return (
    <div className="app-layout">
      {/* ================= MOBILE HEADER ================= */}
      <header className="mobile-header">
        <div className="mobile-header-logo">
          <ShoppingBag size={22} />
          <span>RZK STORE</span>
        </div>
        <div className="mobile-header-user">
          {buyerName ? buyerName.charAt(0).toUpperCase() : 'U'}
        </div>
      </header>

      {/* ================= SIDEBAR MENU ================= */}
      <aside className="sidebar">
        <div className="sidebar-logo">
          <ShoppingBag size={28} />
          <h1>RZK STORE</h1>
        </div>

        {/* Grup Menu Belanja */}
        <div className="sidebar-menu-group">
          <div className="sidebar-menu-label">Belanja</div>
          <ul className="sidebar-menu-list">
            <li>
              <button 
                className={`sidebar-item ${currentTab === 'catalog' ? 'active' : ''}`}
                onClick={() => handleSidebarClick('catalog')}
              >
                <ShoppingCart size={18} />
                <span>Katalog Produk</span>
              </button>
            </li>
            <li>
              <button 
                className={`sidebar-item ${currentTab === 'my-orders' ? 'active' : ''}`}
                onClick={() => handleSidebarClick('my-orders')}
              >
                <History size={18} />
                <span>Riwayat Pesanan</span>
              </button>
            </li>
          </ul>
        </div>

        {/* Grup Menu Portal Admin (Hanya terlihat oleh Admin di path /admin) */}
        {isAdminMode && (
          <div className="sidebar-menu-group">
            <div className="sidebar-menu-label">Portal Admin</div>
            <ul className="sidebar-menu-list">
              <li>
                <button 
                  className={`sidebar-item ${currentTab === 'admin-dashboard' ? 'active' : ''}`}
                  onClick={() => handleSidebarClick('admin-dashboard')}
                >
                  <Settings size={18} />
                  <span>Dashboard Admin</span>
                </button>
              </li>
              <li>
                <button 
                  className={`sidebar-item ${currentTab === 'admin-products' ? 'active' : ''}`}
                  onClick={() => handleSidebarClick('admin-products')}
                >
                  <Plus size={18} />
                  <span>Kelola Produk</span>
                </button>
              </li>
              <li>
                <button 
                  className={`sidebar-item ${currentTab === 'admin-transactions' ? 'active' : ''}`}
                  onClick={() => handleSidebarClick('admin-transactions')}
                >
                  <History size={18} />
                  <span>Riwayat Transaksi</span>
                </button>
              </li>
            </ul>
          </div>
        )}

        {/* User Info (Di bagian bawah sidebar) */}
        <div style={{ marginTop: 'auto', paddingTop: '1rem', borderTop: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <div style={{ width: '40px', height: '40px', borderRadius: '50%', background: '#e6f0ff', color: '#0066fe', display: 'flex', justifyContent: 'center', alignItems: 'center', fontWeight: 'bold' }}>
            {buyerName ? buyerName.charAt(0).toUpperCase() : 'U'}
          </div>
          <div style={{ overflow: 'hidden' }}>
            <div style={{ fontWeight: '700', fontSize: '0.9rem', whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden', color: 'var(--text-main)' }}>
              {buyerName || 'Tamu / Pembeli'}
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>
              {buyerEmail || 'Toko Internet & VPN'}
            </div>
          </div>
        </div>
      </aside>

      {/* ================= MAIN PANEL ================= */}
      <div className="main-content">
        
        {/* ================= BANNER & STATS DAHBOARD ================= */}
        {!activeTx && (
          <>
            {/* Dashboard Banner */}
            <div className="dashboard-banner">
              <span className="banner-welcome-badge">Selamat Datang</span>
              <h2>{buyerName ? `${buyerName} 👋` : 'Temukan Koneksi Tercepat Anda 👋'}</h2>
              <p>
                {currentTab.startsWith('admin') 
                  ? 'Portal Pengelola RZK Store. Atur daftar paket produk, cek log pembayaran callback otomatis, dan kelola konfigurasi QRIS Anda.'
                  : 'Kelola pesanan produk digital Anda, cek status transaksi terbaru, atau nikmati belanja instan dari katalog kami.'}
              </p>
              <div className="banner-welcome-actions">
                {currentTab !== 'catalog' && !currentTab.startsWith('admin') && (
                  <button className="btn btn-secondary" style={{ background: '#fff', color: '#0066fe', border: 'none' }} onClick={() => setCurrentTab('catalog')}>
                    Jelajahi Katalog
                  </button>
                )}
              </div>
              <div className="banner-meta">
                <div className="banner-meta-pill">
                  <span className="dot"></span>
                  Status Toko: Aktif
                </div>
                <div className="banner-meta-pill">
                  ⚡ VPN Server: Online
                </div>
              </div>
            </div>

            {/* Stats Grid */}
            <div className="stats-grid">
              <div className="stats-card">
                <div className="stats-icon-container blue">
                  <ShoppingCart size={24} />
                </div>
                <div className="stats-info">
                  <span className="stats-label">{currentTab.startsWith('admin') ? 'Total Transaksi' : 'Total Pesanan'}</span>
                  <span className="stats-number">{stats.totalCount}</span>
                </div>
              </div>
              <div className="stats-card">
                <div className="stats-icon-container green">
                  <CheckCircle size={24} />
                </div>
                <div className="stats-info">
                  <span className="stats-label">Pesanan Selesai</span>
                  <span className="stats-number">{stats.successCount}</span>
                </div>
              </div>
              <div className="stats-card">
                <div className="stats-icon-container orange">
                  <Clock size={24} />
                </div>
                <div className="stats-info">
                  <span className="stats-label">Menunggu Pembayaran</span>
                  <span className="stats-number">{stats.pendingCount}</span>
                </div>
              </div>
              <div className="stats-card">
                <div className="stats-icon-container info">
                  <Wallet size={24} />
                </div>
                <div className="stats-info">
                  <span className="stats-label">{currentTab.startsWith('admin') ? 'Total Pendapatan' : 'Total Belanja'}</span>
                  <span className="stats-number">Rp {stats.totalSpent.toLocaleString('id-ID')}</span>
                </div>
              </div>
            </div>
          </>
        )}

        {/* ================= TAB 1: KATALOG PRODUK ================= */}
        {currentTab === 'catalog' && !activeTx && (
          <section>
            <div className="section-header">
              <h2>Katalog Produk</h2>
              <p>Pilih paket internet atau VPN yang Anda butuhkan dan nikmati akses instan.</p>
            </div>
            
            <div className="products-grid">
              {products.length === 0 ? (
                <div style={{ textAlign: 'center', gridColumn: '1/-1', color: 'var(--text-muted)', padding: '3rem' }}>
                  <RefreshCw className="spinner" style={{ margin: '0 auto 1rem' }} />
                  <p>Memuat produk...</p>
                </div>
              ) : (
                products.map((product) => (
                  <div key={product.id} className="premium-card product-card">
                    <div className="product-info">
                      <h4>{product.name}</h4>
                      <div className="product-price">
                        Rp {product.price.toLocaleString('id-ID')}
                        <span>/ paket</span>
                      </div>
                      <p className="product-desc">{product.description || 'Tidak ada deskripsi paket.'}</p>
                    </div>
                    <button 
                      className="btn btn-primary" 
                      style={{ width: '100%' }}
                      onClick={() => setCheckoutProduct(product)}
                    >
                      Beli Sekarang
                    </button>
                  </div>
                ))
              )}
            </div>
          </section>
        )}

        {/* ================= TAB 2: RIWAYAT PESANAN SAYA ================= */}
        {currentTab === 'my-orders' && !activeTx && (
          <section className="premium-card">
            <h3>Riwayat Pesanan Anda</h3>
            <div className="table-container">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Tanggal</th>
                    <th>Nomor Referensi</th>
                    <th>Produk</th>
                    <th>Total Harga</th>
                    <th>Status</th>
                    <th>Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  {myTransactions.length === 0 ? (
                    <tr>
                      <td colSpan="6" style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem' }}>
                        Anda belum melakukan pembelian di toko ini.
                      </td>
                    </tr>
                  ) : (
                    myTransactions.map((tx) => {
                      const isExpired = isTxExpired(tx);
                      const displayStatus = isExpired ? 'expired' : tx.status;
                      return (
                        <tr key={tx.id}>
                          <td>{new Date(tx.created_at).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' })}</td>
                          <td style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>ORD-{tx.id.substring(0, 8).toUpperCase()}</td>
                          <td><strong>{tx.products?.name || 'Produk Dihapus'}</strong></td>
                          <td style={{ fontWeight: '700' }}>Rp {Number(tx.amount).toLocaleString('id-ID')}</td>
                          <td>
                            <span className={`status-badge status-${displayStatus}`}>
                              {displayStatus === 'paid' ? 'Berhasil' : displayStatus === 'pending' ? 'Pending' : 'Kadaluarsa'}
                            </span>
                          </td>
                          <td>
                            {displayStatus === 'paid' ? (
                              <button 
                                className="btn btn-secondary btn-small"
                                onClick={() => {
                                  setActiveTx(tx);
                                  setTxStatus('paid');
                                  fetchSuccessProductConfig(tx.product_id);
                                }}
                              >
                                <Eye size={12} />
                                Lihat Akun
                              </button>
                            ) : displayStatus === 'pending' ? (
                              <button 
                                className="btn btn-primary btn-small"
                                onClick={async () => {
                                  // Buka kembali QRIS pembayaran pending
                                  const qrisPayload = generateDynamicQRIS(staticQris, tx.amount);
                                  setDynamicQrisPayload(qrisPayload);
                                  const qrUrl = await QRCode.toDataURL(qrisPayload, { width: 300, margin: 2 });
                                  setQrisQrCodeUrl(qrUrl);
                                  setActiveTx(tx);
                                  setTxStatus('pending');
                                }}
                              >
                                Bayar Sekarang
                              </button>
                            ) : (
                              <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Kadaluarsa</span>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* ================= TAB 3: PORTAL ADMIN LOGIN ================= */}
        {currentTab.startsWith('admin') && !adminAuthenticated && (
          <div className="premium-card" style={{ maxWidth: '420px', margin: '4rem auto', padding: '2.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '1.25rem', color: 'var(--color-primary-start)' }}>
              <Lock size={40} />
            </div>
            <h3 style={{ textOrigin: 'center', fontSize: '1.4rem', marginBottom: '1.5rem', textAlign: 'center' }}>Portal Admin Login</h3>
            <form onSubmit={handleAdminLogin}>
              <div className="form-group">
                <label htmlFor="adminEmail">Alamat Email</label>
                <input 
                  type="email" 
                  id="adminEmail" 
                  className="form-input" 
                  required 
                  placeholder="admin@email.com"
                  value={adminEmailInput}
                  onChange={(e) => setAdminEmailInput(e.target.value)}
                />
              </div>
              <div className="form-group">
                <label htmlFor="adminPassword">Password</label>
                <input 
                  type="password" 
                  id="adminPassword" 
                  className="form-input" 
                  required 
                  placeholder="••••••••"
                  value={adminPasswordInput}
                  onChange={(e) => setAdminPasswordInput(e.target.value)}
                />
              </div>
              <button type="submit" className="btn btn-primary" style={{ width: '100%', marginTop: '1.5rem' }} disabled={loadingAdminAction}>
                {loadingAdminAction ? <RefreshCw className="spinner" /> : <><Key size={18} /> Masuk</>}
              </button>
            </form>
          </div>
        )}

        {/* Tab 3A: Dashboard Admin (Ringkasan & Settings QRIS) */}
        {currentTab === 'admin-dashboard' && adminAuthenticated && (
          <div className="admin-grid">
            <div className="premium-card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                <h3 style={{ margin: 0 }}>Ringkasan Aktivitas Toko</h3>
                <button className="btn btn-danger btn-small" onClick={handleAdminLogout}>
                  Keluar Admin
                </button>
              </div>
              <p style={{ color: 'var(--text-muted)', marginBottom: '1.5rem' }}>
                Selamat datang di portal admin. Berikut adalah ringkasan penjualan toko digital Anda secara keseluruhan.
              </p>
              <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                <div style={{ background: '#f8fafc', padding: '1rem 1.5rem', borderRadius: '12px', border: '1px solid #e2e8f0', flex: 1, minWidth: '150px' }}>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 'bold' }}>PRODUK AKTIF</div>
                  <div style={{ fontSize: '1.5rem', fontWeight: '800', marginTop: '0.25rem' }}>{adminProducts.length}</div>
                </div>
                <div style={{ background: '#f8fafc', padding: '1rem 1.5rem', borderRadius: '12px', border: '1px solid #e2e8f0', flex: 1, minWidth: '150px' }}>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 'bold' }}>TOTAL TRANSAKSI</div>
                  <div style={{ fontSize: '1.5rem', fontWeight: '800', marginTop: '0.25rem' }}>{adminTransactions.length}</div>
                </div>
                <div style={{ background: '#f8fafc', padding: '1rem 1.5rem', borderRadius: '12px', border: '1px solid #e2e8f0', flex: 1, minWidth: '150px' }}>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 'bold' }}>SUKSES TERBAYAR</div>
                  <div style={{ fontSize: '1.5rem', fontWeight: '800', marginTop: '0.25rem' }}>{adminTransactions.filter(t => t.status === 'paid').length}</div>
                </div>
              </div>

              <div style={{ marginTop: '2rem', padding: '1rem', background: '#ecfeff', color: '#0891b2', borderRadius: '12px', display: 'flex', gap: '0.75rem', fontSize: '0.9rem' }}>
                <Info size={20} style={{ flexShrink: 0 }} />
                <div>
                  <strong>Tip Penjualan:</strong> Untuk menerima notifikasi otomatis di dashboard ini, pastikan URL webhook callback Netlify Anda sudah didaftarkan di aplikasi Android Callback Anda.
                </div>
              </div>
            </div>

            <div className="premium-card">
              <h3>QRIS Merchant Setting</h3>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '1.25rem' }}>
                Masukkan string/payload QRIS Statis Merchant (dari DANA, OVO, dll).
              </p>
              <form onSubmit={handleSaveStaticQris}>
                <div className="form-group">
                  <label htmlFor="staticQrisInput">Payload QRIS Statis</label>
                  <textarea 
                    id="staticQrisInput"
                    className="form-input"
                    rows="5"
                    required
                    style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}
                    value={staticQris}
                    onChange={(e) => setStaticQris(e.target.value)}
                  />
                </div>
                <button type="submit" className="btn btn-primary" style={{ width: '100%' }}>
                  Simpan QRIS Statis
                </button>
              </form>
            </div>
          </div>
        )}

        {/* Tab 3B: Kelola Produk Admin */}
        {currentTab === 'admin-products' && adminAuthenticated && (
          <div className="admin-grid">
            <div className="premium-card">
              <h3>Kelola Daftar Produk</h3>
              <div className="table-container">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Nama Produk</th>
                      <th>Harga</th>
                      <th>Aksi</th>
                    </tr>
                  </thead>
                  <tbody>
                    {adminProducts.length === 0 ? (
                      <tr>
                        <td colSpan="3" style={{ textAlign: 'center', color: 'var(--text-muted)' }}>Belum ada produk terdaftar.</td>
                      </tr>
                    ) : (
                      adminProducts.map((prod) => (
                        <tr key={prod.id}>
                          <td>
                            <div style={{ fontWeight: '700' }}>{prod.name}</div>
                            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap', maxWidth: '250px' }}>
                              {prod.description}
                            </div>
                          </td>
                          <td style={{ fontWeight: '700', color: 'var(--color-primary-start)' }}>Rp {prod.price.toLocaleString('id-ID')}</td>
                          <td>
                            <button 
                              className="btn btn-danger btn-small"
                              onClick={() => handleDeleteProduct(prod.id)}
                            >
                              <Trash size={12} />
                              Hapus
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="premium-card">
              <h3>Tambah Produk Baru</h3>
              <form onSubmit={handleAddProduct}>
                <div className="form-group">
                  <label htmlFor="prodName">Nama Produk / Paket</label>
                  <input 
                    type="text" 
                    id="prodName" 
                    className="form-input" 
                    required 
                    placeholder="Contoh: VPN Premium - 30 Hari"
                    value={newProductName}
                    onChange={(e) => setNewProductName(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="prodPrice">Harga Produk (Rp)</label>
                  <input 
                    type="number" 
                    id="prodPrice" 
                    className="form-input" 
                    required 
                    placeholder="15000"
                    value={newProductPrice}
                    onChange={(e) => setNewProductPrice(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="prodDesc">Deskripsi Paket</label>
                  <textarea 
                    id="prodDesc" 
                    className="form-input" 
                    rows="3" 
                    placeholder="Masa aktif, server, speed limit..."
                    value={newProductDesc}
                    onChange={(e) => setNewProductDesc(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="prodVmess">Konfigurasi VMess URI</label>
                  <textarea 
                    id="prodVmess" 
                    className="form-input" 
                    rows="3" 
                    required
                    placeholder="vmess://..."
                    style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}
                    value={newProductVmess}
                    onChange={(e) => setNewProductVmess(e.target.value)}
                  />
                </div>
                <button type="submit" className="btn btn-primary" style={{ width: '100%', marginTop: '1rem' }} disabled={loadingAdminAction}>
                  {loadingAdminAction ? <RefreshCw className="spinner" /> : <><Plus size={16} /> Simpan Paket</>}
                </button>
              </form>
            </div>
          </div>
        )}

        {/* Tab 3C: Riwayat Transaksi Toko */}
        {currentTab === 'admin-transactions' && adminAuthenticated && (
          <section className="premium-card">
            <h3>Log Transaksi Seluruh Pembeli</h3>
            <div className="table-container">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Tanggal</th>
                    <th>Nama Pembeli</th>
                    <th>Paket</th>
                    <th>Nominal Masuk</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {adminTransactions.length === 0 ? (
                    <tr>
                      <td colSpan="5" style={{ textAlign: 'center', color: 'var(--text-muted)' }}>Belum ada transaksi di toko.</td>
                    </tr>
                  ) : (
                    adminTransactions.map((tx) => (
                      <tr key={tx.id}>
                        <td>{new Date(tx.created_at).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' })}</td>
                        <td>
                          <strong>{tx.buyer_name}</strong>
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{tx.buyer_email}</div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontFamily: 'monospace' }}>{tx.buyer_phone || '-'}</div>
                        </td>
                        <td>{tx.products?.name || 'Produk Dihapus'}</td>
                        <td style={{ fontWeight: '700' }}>
                          Rp {Number(tx.amount).toLocaleString('id-ID')}
                          <span style={{ display: 'block', fontSize: '0.75rem', color: 'var(--color-primary-start)', fontWeight: 'normal' }}>
                            Kode unik: {tx.unique_code}
                          </span>
                        </td>
                        <td>
                          <span className={`status-badge status-${tx.status}`}>
                            {tx.status === 'paid' ? 'Lunas' : tx.status === 'pending' ? 'Pending' : 'Kadaluarsa'}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* ================= MODAL OVERLAY: CHECKOUT ================= */}
        {checkoutProduct && (
          <div className="modal-overlay">
            <div className="modal-content premium-card">
              <button className="close-btn" onClick={() => setCheckoutProduct(null)}>
                <X size={20} />
              </button>
              <h3 style={{ fontSize: '1.4rem', border: 'none', marginBottom: '0.25rem' }}>Checkout Paket</h3>
              <p style={{ color: 'var(--text-muted)', marginBottom: '1.5rem', fontSize: '0.9rem' }}>
                Anda memesan: <strong>{checkoutProduct.name}</strong> seharga Rp {checkoutProduct.price.toLocaleString('id-ID')}
              </p>

              <form onSubmit={handleCheckoutSubmit}>
                <div className="form-group">
                  <label htmlFor="buyerName">Nama Lengkap</label>
                  <input 
                    type="text" 
                    id="buyerName" 
                    className="form-input" 
                    required 
                    placeholder="Nama Anda"
                    value={buyerName}
                    onChange={(e) => setBuyerName(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="buyerEmail">Email Aktif</label>
                  <input 
                    type="email" 
                    id="buyerEmail" 
                    className="form-input" 
                    required 
                    placeholder="nama@email.com"
                    value={buyerEmail}
                    onChange={(e) => setBuyerEmail(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="buyerPhone">Nomor WhatsApp / HP</label>
                  <input 
                    type="tel" 
                    id="buyerPhone" 
                    className="form-input" 
                    required 
                    placeholder="0812xxxxxxxx"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={buyerPhone}
                    onChange={(e) => setBuyerPhone(e.target.value.replace(/\D/g, ''))}
                  />
                </div>
                <button 
                  type="submit" 
                  className="btn btn-primary" 
                  style={{ width: '100%', marginTop: '1.5rem' }}
                  disabled={loadingCheckout}
                >
                  {loadingCheckout ? <RefreshCw className="spinner" /> : 'Buat Tagihan QRIS'}
                </button>
              </form>
            </div>
          </div>
        )}

        {/* ================= TAGIHAN QRIS PEMBAYARAN PENDING ================= */}
        {activeTx && txStatus === 'pending' && (
          <div className="modal-overlay">
            <div className="modal-content premium-card text-center" style={{ maxWidth: '460px', padding: '2.5rem' }}>
              <button className="close-btn" onClick={() => setActiveTx(null)}>
                <X size={20} />
              </button>
              <div className="qris-container">
                <h3 style={{ fontSize: '1.3rem', border: 'none', marginBottom: '0.5rem' }}>Scan QRIS Dinamis</h3>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '1rem' }}>Silakan bayar menggunakan Aplikasi e-Wallet / Bank Anda.</p>
                
                <div className="qris-amount">
                  Rp {Number(activeTx.amount).toLocaleString('id-ID')}
                </div>
                <div className="qris-unique-indicator">
                  Termasuk Kode Unik (+Rp {activeTx.unique_code})
                </div>

                <div className="qris-qr-box">
                  {qrisQrCodeUrl ? (
                    <img src={qrisQrCodeUrl} alt="QRIS Dinamis" width="220" height="220" />
                  ) : (
                    <RefreshCw className="spinner" style={{ margin: '3rem' }} />
                  )}
                </div>

                <div className="qris-waiting-status animate-pulse-glow" style={{ color: 'var(--color-primary-start)' }}>
                  <RefreshCw className="spinner" style={{ width: '14px', height: '14px', marginRight: '0.25rem' }} />
                  Menunggu Pembayaran Masuk... ({formatTime(timeLeft)})
                </div>

                <div style={{ background: '#f8fafc', padding: '0.85rem', borderRadius: '10px', fontSize: '0.75rem', color: 'var(--text-muted)', textAlign: 'left', border: '1px solid var(--border-color)', width: '100%' }}>
                  💡 <strong>PENTING:</strong> Bayar nominal <strong>PERSIS</strong> sesuai harga di atas. Jika berbeda, verifikasi otomatis akan gagal.
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ================= PEMBAYARAN EXPIRED ================= */}
        {activeTx && txStatus === 'expired' && (
          <div className="modal-overlay">
            <div className="modal-content premium-card text-center" style={{ maxWidth: '460px', padding: '2.5rem' }}>
              <button className="close-btn" onClick={() => {
                setActiveTx(null);
                loadMyOrders();
              }}>
                <X size={20} />
              </button>
              <div className="success-container">
                <div className="success-icon" style={{ background: 'var(--color-danger-bg)', color: 'var(--color-danger)' }}>
                  <AlertCircle size={32} />
                </div>
                <h2 className="success-title" style={{ background: 'none', color: 'var(--color-danger)', WebkitTextFillColor: 'initial' }}>
                  Pembayaran Kadaluarsa
                </h2>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: '0.5rem', marginBottom: '1.5rem' }}>
                  Batas waktu pembayaran 20 menit telah habis. Kode unik Anda tidak lagi valid untuk dicocokkan otomatis. Silakan buat pesanan baru.
                </p>
                <button 
                  className="btn btn-secondary" 
                  style={{ width: '100%' }}
                  onClick={() => {
                    setActiveTx(null);
                    loadMyOrders();
                  }}
                >
                  Tutup
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ================= PEMBAYARAN SUKSES & VPN CONFIG VIEW ================= */}
        {activeTx && txStatus === 'paid' && (
          <div className="modal-overlay">
            <div className="modal-content premium-card" style={{ maxWidth: '550px', padding: '2.5rem' }}>
              <button className="close-btn" onClick={() => {
                setActiveTx(null);
                loadMyOrders();
              }}>
                <X size={20} />
              </button>
              <div className="success-container">
                <div className="success-icon">
                  <CheckCircle size={32} />
                </div>
                <h2 className="success-title">Pembayaran Berhasil!</h2>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                  Pesanan untuk <strong>{activeTx.buyer_name}</strong> terverifikasi otomatis.
                </p>

                <div className="config-box">
                  <div className="config-header">
                    <span>VMess Link URI</span>
                    <button 
                      className="btn btn-secondary btn-small"
                      onClick={() => copyToClipboard(activeTx.vpn_config || '')}
                      disabled={!activeTx.vpn_config}
                    >
                      {copiedVmess ? 'Tersalin!' : <><Copy size={12} /> Salin Link</>}
                    </button>
                  </div>
                  <div className="config-text">
                    {activeTx.vpn_config || 'Mengambil konfigurasi VMess...'}
                  </div>

                  {vmessQrCodeUrl && (
                    <div className="config-qr-section">
                      <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: '700' }}>Scan QR Code di bawah dengan v2rayNG / Shadowrocket:</p>
                      <div style={{ background: 'white', padding: '0.5rem', borderRadius: '10px', marginTop: '0.5rem', display: 'inline-block', border: '1px solid #e2e8f0' }}>
                        <img src={vmessQrCodeUrl} alt="VMess QR Code" width="160" height="160" />
                      </div>
                    </div>
                  )}
                </div>

                <button 
                  className="btn btn-primary" 
                  style={{ width: '100%', padding: '0.75rem' }}
                  onClick={() => {
                    setActiveTx(null);
                    loadMyOrders();
                  }}
                >
                  Selesai
                </button>
              </div>
            </div>
          </div>
        )}

      </div>

      {/* ================= MOBILE BOTTOM NAVIGATION ================= */}
      <nav className="mobile-bottom-nav">
        {!isAdminMode ? (
          <>
            <button 
              className={`mobile-nav-item ${currentTab === 'catalog' ? 'active' : ''}`}
              onClick={() => handleSidebarClick('catalog')}
            >
              <ShoppingCart size={20} />
              <span>Katalog</span>
            </button>
            <button 
              className={`mobile-nav-item ${currentTab === 'my-orders' ? 'active' : ''}`}
              onClick={() => handleSidebarClick('my-orders')}
            >
              <History size={20} />
              <span>Pesanan Saya</span>
            </button>
          </>
        ) : (
          <>
            <button 
              className={`mobile-nav-item ${currentTab === 'admin-dashboard' ? 'active' : ''}`}
              onClick={() => handleSidebarClick('admin-dashboard')}
            >
              <Settings size={20} />
              <span>Dashboard</span>
            </button>
            <button 
              className={`mobile-nav-item ${currentTab === 'admin-products' ? 'active' : ''}`}
              onClick={() => handleSidebarClick('admin-products')}
            >
              <Plus size={20} />
              <span>Produk</span>
            </button>
            <button 
              className={`mobile-nav-item ${currentTab === 'admin-transactions' ? 'active' : ''}`}
              onClick={() => handleSidebarClick('admin-transactions')}
            >
              <History size={20} />
              <span>Transaksi</span>
            </button>
          </>
        )}
      </nav>
    </div>
  );
}

export default App;
