import json
from pathlib import Path
root=Path(__file__).resolve().parents[1]
s={'type':['string','null'],'maxLength':512}; n={'type':['number','null']}; b={'type':['boolean','null']}; short={'type':['string','null'],'maxLength':160}; text={'type':['string','null'],'maxLength':8000}
def obj(p):return {'type':['object','null'],'properties':p,'additionalProperties':False}
def arr(v,limit=50000):return {'type':['array','null'],'items':v,'maxItems':limit}
def props(keys,typ=s):return {k:typ for k in keys.split()}
date={'anyOf':[n,s,obj({'$date':{'anyOf':[n,s,obj({'$numberLong':s})]}})]}
row=obj({'section':s,'type':s,'name':s,'nameRu':s,'instanceId':s,'count':n,'xp':n,'rank':n,'polarizationCount':n,'featureFlags':n,'modularParts':arr(s,16),'configs':arr(obj({'index':n,'name':short,'mods':arr(obj({'slot':n,'reference':s,'type':s,'rank':n}),32)}),12),'polarities':arr(obj({'slot':n,'value':s}),32),'shards':arr(obj({'slot':n,'type':s,'color':s}),5),'roll':obj({'rank':n,'rerolls':n,'compatibility':s,'buffs':arr(obj({'tag':s,'rawValue':n}),8),'curses':arr(obj({'tag':s,'rawValue':n}),8)}),'completesAt':n})
profile_mastery=obj({**props('rank percentToNext totalXp xpIntoRank xpForNext',n),'testReady':b})
game=obj({**props('uniqueName name nameRu category productCategory type nameKey buildsProduct'),**props('masteryReq ducats',n),**props('tradable vaulted masterable isPrime',b),'description':text,'recipe':obj({**props('buildPrice buildTime num',n),'blueprintUniqueName':s,'reusableBlueprint':b,'ingredients':arr(obj({'uniqueName':s,'count':n}),100)}),'components':arr(obj({'uniqueName':s,'name':s,'itemCount':n}),100),'drops':arr(obj({'location':s,'type':s,'chance':n,'rarity':s}),300)})
loadout=obj({'mode':s,'index':n,'name':short,'slots':arr(obj({'slot':s,'instanceId':s,'modConfig':n,'appearanceConfig':n}),32)})
raw_item=obj({**props('ItemType Name'),**props('ItemCount XP Polarized Features',n),'ItemId':obj({'$oid':s}),'Configs':arr(obj({'Name':short,'Upgrades':arr(s,32),'Arcanes':arr(s,8),'AbilityOverride':s,'FocusLens':s}),12),'Polarity':n,'PolarizedSlots':arr(obj({'Slot':n,'Value':s}),32),'ModularParts':arr(s,16),'CompletionDate':date,'ExpiryDate':date,'ActivationDate':date,'PendingRerollFingerprint':s})
# Fingerprints are parsed separately; never forward the raw JSON/auth-looking strings.
raw_item['properties'].pop('PendingRerollFingerprint')
remaining_keys='DailyFocus DailyAffiliation DailyAffiliationCetus DailyAffiliationSolaris DailyAffiliationVentkids DailyAffiliationEntrati DailyAffiliationNecraloid DailyAffiliationZariman DailyAffiliationCavia DailyAffiliationHex DailyTrades DailyGifts EntratiVaultCountLastPeriod ConquestScore LastConquestScore DuviriConquestScore'
def section(title,schema,note='Поля только из полученного снимка; отсутствие поля не означает нулевое значение.'):return {'title':title,'schema':schema,'note':note}
specs={
 'account':section('Аккаунт: ранг мастерства и валюты',obj({**props('masteryRank masteryXp credits platinum endo',n)})),
 'loadouts':section('Сохранённые комплекты снаряжения',loadout,'Выбранная мод-конфигурация и внешность — разные индексы. Сохранённый комплект не доказывает, что он сейчас активен в игре.'),
 'game.items':section('Игровой справочник: предметы, рецепты и источники',game,'Справочник WantedFrame: DE/Public Export и WFCD. Дата упаковки не является датой обновления игры. Урон и эффекты не вычислены.'),
 'mastery.summary':section('Расчёт прогресса мастерства',profile_mastery,'Расчёт существующего WantedFrame по инвентарю и справочнику. Не путать полученный опыт и сдачу испытания ранга.'),
 'mastery.items':section('Освоенное снаряжение и оставшийся опыт',obj({**props('name displayName uniqueName category status'),**props('rank maxRank masteryXp masteryXpRemaining',n),**props('currentlyOwned needsGilding',b)}),'Освоенное когда-то не обязательно есть в инвентаре сейчас; статус missing основан на покрытии входного снимка.'),
 'progress.Affiliations':section('Синдикаты: ранги, репутация, недельные данные',obj({'Tag':s,'Standing':n,'Title':n,'WeeklyMissions':arr(obj({'WeekCount':n,'CompletedMission':b}),100)})),
 'progress.Missions':section('Узлы карты и прохождения',obj({'Tag':s,'Completes':n,'Tier':n})),
 'progress.PlayerSkills':section('Внутренние навыки и очки',obj({'key':s,'value':n}),'Исходные ключи LPS_/LPP_. Числовые значения не переименовываются по догадке.'),
 'progress.FocusXP':section('Опыт Фокуса',obj({'key':s,'value':n})),
 'progress.DailyLimits':section('Дневные лимиты и недельные счётчики',obj({'key':s,'value':n}),'DailyFocus/DailyAffiliation — остаток, не потраченное. Старый снимок не учитывает сброс дня.'),
 'progress.ChallengeProgress':section('Счётчики испытаний',obj({'Name':s,'Progress':n}),'Счётчик не доказывает выполнение текущего задания: он может обнуляться или переиспользоваться.'),
 'progress.PeriodicMissionCompletions':section('Периодические прохождения',obj({'tag':s,'date':obj({'$date':obj({'$numberLong':s})}),'Tag':s,'Count':n,'Date':date}),'Дата записи относится к прохождению; capturedAt — дата снимка. tag/date и прежние Tag/Date сохраняются как поля источника; отсутствие Count не означает ноль.'),
 'progress.LibraryActiveDailyTaskInfo':section('Задание сканирования',obj({'Scans':n,'ScansRequired':n,'TargetType':s})),
 'progress.ResetDates':section('Даты сброса наград и лимитов',obj({'key':s,'value':date})),
 'profile.career':section('Карьера и статистика аккаунта',obj({'key':s,'value':n}),'Отдельный кеш публичного профиля, привязанный к тому же аккаунту; имеет собственную дату.'),
 'profile.equipment':section('Статистика использования снаряжения',obj({'type':s,**props('equipTime kills headshots assists xp',n)})),
 'profile.enemies':section('Противники и сканирования',obj({'type':s,**props('kills headshots assists finishers deaths scans',n)})),
 'profile.abilities':section('Использование способностей',obj({'type':s,'name':s,'used':n})),
 'profile.missions':section('Рекорды миссий',obj({'type':s,'name':s,'highScore':n})),
}
collections={'Suits':'Варфреймы','LongGuns':'Основное оружие','Pistols':'Вторичное оружие','Melee':'Оружие ближнего боя','Sentinels':'Стражи','SentinelWeapons':'Оружие стражей','SpaceSuits':'Арчвинги','SpaceGuns':'Оружие Арчвинга','SpaceMelee':'Ближний бой Арчвинга','OperatorAmps':'Усилители','MechSuits':'Некрамехи','Hoverboards':'К-Драйвы','MoaPets':'МОА','KubrowPets':'Питомцы','DrifterMelee':'Снаряжение Скитальца','MiscItems':'Ресурсы и компоненты','Recipes':'Чертежи','LevelKeys':'Реликвии и ключи','RawUpgrades':'Непрокачанные моды','Upgrades':'Моды: экземпляры и ранги','Arcanes':'Мистификаторы','FusionBundles':'Наборы слияния','Gear':'Снаряжение','XPInfo':'Исторический опыт снаряжения','PendingRecipes':'Производство в Кузнице'}
for k,title in collections.items():specs['inventory.'+k]=section(title,row, 'XPInfo — исторический опыт, а не владение.' if k=='XPInfo' else 'PendingRecipes — производство, а не готовое имущество.' if k=='PendingRecipes' else 'Слоты модов и уникальные экземпляры сохранены. rank=null — ранг не был предоставлен; rawValue модов Разлома — НЕ проценты.')
for k,title in {'QuestKeys':'Квестовые ключи','SpecialItems':'Особое снаряжение','KubrowPetPrints':'Генетические шаблоны','WeaponSkins':'Внешний вид и оформления','Boosters':'Усилители ресурсов/опыта','FlavourItems':'Декоративные предметы'}.items():specs['extra.'+k]=section(title,raw_item,'Отобранные игровые поля исходного формата. Здесь нет автоматического вывода о статусе выполнения квеста.')
specs['extra.Consumables']=section('Расходуемые предметы',obj({'ItemType':s,'ItemCount':n}),'Отдельная коллекция Consumables из инвентаря; ItemCount — количество из снимка на capturedAt. Отсутствие Gear не доказывает отсутствие снаряжения.')
specs['equipment.details']=section('Дополнительные поля конфигураций',raw_item,'Исходные поля, если их предоставляет источник. Arcanes/AbilityOverride/FocusLens не гарантированы. Неразобранные ссылки не следует угадывать.')
shared={'item':row,'gameItem':game,'rawItem':raw_item}
for sec in specs.values():
 for name,val in shared.items():
  if sec['schema']==val:sec['schema']={'$ref':f'#/$defs/{name}'};break
root.joinpath('integrations/wantedframe_mcp/schema.json').write_text(json.dumps({'version':1,'maxBytes':24*1024*1024,'dailyKeys':remaining_keys.split(),'$defs':shared,'sections':specs},ensure_ascii=False,separators=(',',':'))+'\n', encoding='utf-8', newline='\n')
