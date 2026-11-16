# Soutien maths au lycée

La page élève présente l’emploi du temps par semaine. Pour s’inscrire, l’élève indique son nom, son prénom et sa classe, puis choisit ses séances et valide. Les créneaux du midi peuvent se cumuler, y compris 12 h 30–13 h 30 et 13 h–14 h. Le formulaire de contact utilise les mêmes champs d’identité que l’inscription.

## Essayer sur ce Mac

Dans le dossier du projet, lancer `python3 -m http.server 8765 --bind 127.0.0.1 --directory docs`, puis ouvrir [la page de démonstration](http://127.0.0.1:8765/). Le lien « Espace enseignant » ouvre la gestion du planning. En mode démo, les inscriptions fictives restent dans le navigateur et l’espace enseignant s’ouvre directement. En production, la connexion enseignant est obligatoire.

## 1. Préparer les inscriptions dans Supabase

GitHub Pages publie les fichiers de la page. Supabase conserve le planning et les inscriptions et vérifie l’accès enseignant. Les élèves remplissent le formulaire sans créer de compte. [GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages) · [Sécurité des données Supabase](https://supabase.com/docs/guides/database/secure-data)

1. Créer un projet [Supabase](https://supabase.com/dashboard).
2. Dans **Authentication → Users**, créer le compte enseignant avec son adresse e-mail et un mot de passe, confirmer l’adresse lors de la création du compte, puis copier son **User UID**. L’inscription publique de nouveaux comptes peut être désactivée.
3. Ouvrir **SQL Editor → New query**, y copier [le script d’installation](supabase/installation.sql), remplacer l’UUID `00000000-0000-0000-0000-000000000000` par le **User UID**, puis exécuter le script une fois. Il publie uniquement la semaine en cours, selon l’heure de Paris, avec les créneaux habituels.
4. Exécuter ensuite la [mise à jour créneaux et messages](supabase/mise-a-jour-creneaux-messages.sql). Pour un projet déjà installé, exécuter uniquement cette mise à jour.
5. Dans [docs/config.js](docs/config.js), renseigner `supabaseUrl` avec la **Project URL** et `publishableKey` avec la clé **Publishable** (`sb_publishable_…`) disponibles dans le tableau de bord. Cette clé publique est prévue pour une page web. Garde le mot de passe enseignant et les clés privées Supabase hors du dépôt. [Clés Supabase](https://supabase.com/docs/guides/getting-started/api-keys)

## 2. Publier sur GitHub Pages

1. Créer le dépôt GitHub **linaturgan/Soutien_maths**. Y déposer au minimum le dossier `docs/` complet, y compris `.nojekyll`, dans la branche `main`.
2. Dans les réglages du dépôt, choisir **Settings → Pages → Deploy from a branch → main → /docs → Save**. [Configuration de GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)
3. Dès que [la page publique](https://linaturgan.github.io/Soutien_maths/) répond, faire une inscription fictive. Vérifier qu’elle apparaît dans [l’espace enseignant](https://linaturgan.github.io/Soutien_maths/?prof), télécharger la liste d’appel, puis retirer cette inscription de test dans **Supabase → Table Editor → soutien → registrations**.
4. Diffuser [l’affiche d’inscription](output/pdf/affiche-inscription-soutien-maths.pdf). Son QR code et son lien pointent vers l’adresse ci-dessus. Si le nom du dépôt ou le domaine change, régénérer le PDF avec `python3 -m pip install reportlab` puis `python3 outils/affiche.py https://adresse-du-site/`.

## Gérer le planning

- **Ajouter une semaine** propose le prochain lundi disponible. La case « Utiliser les créneaux habituels » reprend le planning du PDF source. Décoche-la pour commencer avec une semaine vide.
- **Ajouter un créneau** permet de préciser le jour, l’horaire et la salle. Pour modifier ou supprimer une séance, ouvrir sa liste d’appel depuis le planning.
- **Télécharger le PDF** produit une feuille A4 avec le nom, le prénom, la classe et une colonne de présence. Le navigateur de l’enseignant génère le PDF.
- Supprimer une séance ou une semaine efface aussi les inscriptions correspondantes. Télécharge la liste au préalable si tu veux la conserver.

- Le nombre d’inscrits apparaît sur chaque carte dans l’espace enseignant. « Actualiser les inscrits » recharge les compteurs et la liste d’appel ouverte.
- Les messages arrivent dans « Messages des élèves » de l’espace enseignant. Une demande d’annulation est un message. Pour la traiter, ouvrir la liste d’appel du créneau et cliquer sur « Annuler » sur la ligne concernée.
- Si un ancien créneau a déjà des inscrits lors du découpage, sa liste d’appel reste accessible sous « Ancien créneau » dans l’espace enseignant. Les nouvelles inscriptions utilisent les plages découpées.
