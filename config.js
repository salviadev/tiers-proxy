module.exports = {
    port: 7500,
    server: {
        host: 'http://10.166.52.120'
    },
    log: {
        level: 'info',  // none, error, info, verbose
        directory: 'c:/temp/logs/tiers-proxy', // 'Optionnel : si non renseigné par défaut ./logs'
    },
    webhooks: [
        {
            topic: 'POST,PUT,PATCH+*/spo/tiers',
            description: 'Propagate POST,PUT,PATCH on tiers to SPO',
            callback: 'http://localhost/GizehDev/M82/ServiceWCF.svc/tiers',
            method: 'POST'
        },
        {
            topic: 'PATCH,PUT+*/spo/thematiques',
            description: 'Propagate PUT,PATCH on thematique tiers to SPO',
            callback: 'http://localhost/GizehDev/M82/ServiceWCF.svc/tiers-thematique',
            method: 'POST'
        },
        {
            topic: 'PATCH+*/spo/tiers',
            description: 'Propagate PUT,PATCH on tiers to Accession RV',
            callback: 'http://localhost:3000/api/tiers/{tenant}',
            method: 'POST'
        }
    ]
};